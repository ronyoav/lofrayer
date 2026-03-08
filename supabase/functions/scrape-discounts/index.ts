const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'LOVABLE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const targetSlug = body?.slug;

    let query = supabase
      .from('memberships')
      .select('*')
      .not('scrape_url', 'is', null);

    if (targetSlug) {
      query = query.eq('slug', targetSlug);
    }

    const { data: memberships, error: membershipError } = await query;

    if (membershipError) {
      throw new Error(`Failed to fetch memberships: ${membershipError.message}`);
    }

    const results: any[] = [];

    for (const membership of memberships || []) {
      try {
        console.log(`Processing ${membership.name}...`);

        // Strategy 1: Scrape with waitFor for JS-heavy sites
        let content = await scrapeWithFirecrawl(firecrawlKey, membership.scrape_url);
        let strategy = 'scrape';

        // Strategy 1.5: If too little content, try with actions (click "show all", scroll, screenshot)
        if (!content.markdown || content.markdown.length < 50) {
          console.log(`Strategy 1 failed for ${membership.name}, trying with actions...`);
          content = await scrapeWithActions(firecrawlKey, membership.scrape_url);
          strategy = 'actions';
        }

        // Strategy 2: If still too little, try screenshot + AI vision
        if ((!content.markdown || content.markdown.length < 50) && !content.screenshot) {
          console.log(`Strategy 1.5 failed for ${membership.name}, trying screenshot...`);
          content = await scrapeWithScreenshot(firecrawlKey, membership.scrape_url);
          strategy = 'screenshot';
        }

        // Strategy 3: If still nothing, search the web for benefits
        if ((!content.markdown || content.markdown.length < 50) && !content.screenshot) {
          console.log(`Strategy 2 failed for ${membership.name}, trying web search...`);
          content = await searchForBenefits(firecrawlKey, membership.name);
          strategy = 'search';
        }

        if ((!content.markdown || content.markdown.length < 50) && !content.screenshot) {
          results.push({
            membership: membership.name,
            slug: membership.slug,
            status: 'no_content',
            strategies_tried: strategy,
          });
          continue;
        }

        console.log(`Got content for ${membership.name} via ${strategy} (${content.markdown?.length || 0} chars markdown, screenshot: ${!!content.screenshot})`);

        // Parse with AI
        const discounts = content.screenshot
          ? await parseScreenshotWithAI(lovableApiKey, content.screenshot, membership)
          : await parseWithAI(lovableApiKey, content.markdown!, membership, content.links || []);

        if (discounts.length > 0) {
          await supabase
            .from('discounts')
            .update({ is_active: false })
            .eq('membership_id', membership.id)
            .not('scraped_at', 'is', null);

          const { error: insertError } = await supabase
            .from('discounts')
            .insert(
              discounts.map((d: any) => ({
                brand: d.brand,
                title: d.title,
                description: d.description || null,
                discount_value: d.discount_value,
                category: d.category || 'כללי',
                location: d.location || 'כל הארץ',
                redeem_url: d.redeem_url || membership.scrape_url || membership.website_url || null,
                membership_id: membership.id,
                scraped_at: new Date().toISOString(),
                is_active: true,
              }))
            );

          if (insertError) {
            console.error(`Insert error for ${membership.name}:`, insertError);
            results.push({ membership: membership.name, slug: membership.slug, status: 'insert_error', error: insertError.message, discountsFound: discounts.length });
            continue;
          }
        }

        results.push({
          membership: membership.name,
          slug: membership.slug,
          status: 'success',
          strategy,
          discountsFound: discounts.length,
        });
      } catch (err) {
        console.error(`Error processing ${membership.name}:`, err);
        results.push({
          membership: membership.name,
          slug: membership.slug,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Scrape error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ─── Strategy 1: Standard scrape with waitFor ───

type ScrapeContent = {
  markdown?: string;
  links?: string[];
  screenshot?: string;
};

async function scrapeWithFirecrawl(apiKey: string, url: string): Promise<ScrapeContent> {
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'links'],
        onlyMainContent: true,
        waitFor: 3000, // Wait 3s for JS to render
      }),
    });
    const data = await response.json();
    if (!response.ok) return {};
    return {
      markdown: data.data?.markdown || data.markdown || '',
      links: data.data?.links || data.links || [],
    };
  } catch (err) {
    console.error('Scrape error:', err);
    return {};
  }
}

// ─── Strategy 1.5: Scrape with actions (click buttons, scroll, screenshot) ───

async function scrapeWithActions(apiKey: string, url: string): Promise<ScrapeContent> {
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'screenshot', 'links'],
        waitFor: 3000,
        actions: [
          // Wait for page to fully load
          { type: 'wait', milliseconds: 2000 },
          // Try clicking common "show all" / "load more" buttons in Hebrew
          { type: 'click', selector: 'button:has-text("הצג הכל")', all: true },
          { type: 'click', selector: 'button:has-text("טען עוד")', all: true },
          { type: 'click', selector: 'button:has-text("הצג עוד")', all: true },
          { type: 'click', selector: 'a:has-text("הצג הכל")', all: true },
          { type: 'click', selector: '[class*="show-all"]', all: true },
          { type: 'click', selector: '[class*="load-more"]', all: true },
          { type: 'wait', milliseconds: 2000 },
          // Scroll down to load lazy content
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1000 },
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1000 },
          // Take a full-page screenshot
          { type: 'screenshot', fullPage: true },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Actions scrape error:', data.error);
      return {};
    }

    const screenshot = data.data?.actions?.screenshots?.[0] || data.data?.screenshot || null;
    return {
      markdown: data.data?.markdown || data.markdown || '',
      links: data.data?.links || data.links || [],
      screenshot,
    };
  } catch (err) {
    console.error('Actions scrape error:', err);
    return {};
  }
}

// ─── Strategy 2: Screenshot + AI vision for JS-heavy sites ───

async function scrapeWithScreenshot(apiKey: string, url: string): Promise<ScrapeContent> {
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        formats: ['screenshot', 'markdown'],
        waitFor: 5000,
      }),
    });
    const data = await response.json();
    if (!response.ok) return {};
    return {
      screenshot: data.data?.screenshot || data.screenshot || null,
      markdown: data.data?.markdown || data.markdown || '',
    };
  } catch (err) {
    console.error('Screenshot error:', err);
    return {};
  }
}

// ─── Strategy 3: Web search for benefits ───

async function searchForBenefits(apiKey: string, membershipName: string): Promise<ScrapeContent> {
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `${membershipName} הנחות צרכניות קופונים מבצעים חנויות מסעדות אופנה`,
        limit: 5,
        scrapeOptions: { formats: ['markdown'] },
      }),
    });
    const data = await response.json();
    if (!response.ok) return {};
    
    // Combine markdown from all search results
    const allMarkdown = (data.data || [])
      .map((r: any) => `## ${r.title || ''}\n${r.markdown || r.description || ''}`)
      .join('\n\n');
    
    return { markdown: allMarkdown };
  } catch (err) {
    console.error('Search error:', err);
    return {};
  }
}

// ─── AI Parsing: Text-based ───

async function parseWithAI(apiKey: string, markdown: string, membership: any, links: string[]): Promise<any[]> {
  const truncatedContent = markdown.substring(0, 8000);
  const linksText = links.slice(0, 100).join('\n');

  const prompt = `אתה מנתח תוכן של דף הטבות מאתר מועדון "${membership.name}".
חלץ רק הנחות צרכניות אמיתיות (מותגים, חנויות, מסעדות, בתי קולנוע, חופשות וכו').
אל תכלול מענקים ממשלתיים, תגמולים, סיוע כלכלי או זכאויות.

כל הנחה צריכה לכלול:
- brand: שם המותג/בית העסק (בעברית)
- title: כותרת ההנחה (קצרה וברורה)
- description: תיאור קצר של ההטבה
- discount_value: ערך ההנחה (לדוגמה: "20%", "1+1", "50₪ הנחה", "חינם")
- category: קטגוריה (אחת מ: אופנה, מזון, בריאות, בידור, חשמל, ספורט, תיירות, רכב, ביטוח, פיננסי, לימודים, כללי)
- location: מיקום אם מצוין (או "כל הארץ")
- redeem_url: הלינק הספציפי למימוש ההטבה אם קיים ברשימת הלינקים (לא הדף הראשי!)

רשימת הלינקים שנמצאו בדף:
${linksText}

החזר רק JSON array תקני, ללא טקסט נוסף. אם אין הנחות צרכניות, החזר [].`;

התוכן:
${truncatedContent}`;

  return await callAI(apiKey, [{ role: 'user', content: prompt }]);
}

// ─── AI Parsing: Screenshot (vision) ───

async function parseScreenshotWithAI(apiKey: string, screenshotBase64: string, membership: any): Promise<any[]> {
  const prompt = `אתה מנתח צילום מסך של דף הטבות מאתר מועדון "${membership.name}".
חלץ רק הנחות צרכניות (מותגים, חנויות, מסעדות, קולנוע, חופשות). אל תכלול מענקים ממשלתיים או תגמולים.

כל הנחה צריכה לכלול:
- brand: שם המותג/בית העסק (בעברית)
- title: כותרת ההנחה (קצרה וברורה)
- description: תיאור קצר
- discount_value: ערך ההנחה
- category: קטגוריה (אופנה, מזון, בריאות, בידור, חשמל, ספורט, תיירות, רכב, ביטוח, פיננסי, לימודים, כללי)
- location: מיקום אם מצוין (או "כל הארץ")

החזר רק JSON array תקני, ללא טקסט נוסף.`;

  const imageUrl = screenshotBase64.startsWith('http') 
    ? screenshotBase64 
    : `data:image/png;base64,${screenshotBase64}`;

  return await callAI(apiKey, [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ]);
}

// ─── Shared AI call ───

async function callAI(apiKey: string, messages: any[]): Promise<any[]> {
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`AI API error: ${response.status}`, errText);
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log('No JSON array found in AI response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('AI parsing error:', err);
    return [];
  }
}
