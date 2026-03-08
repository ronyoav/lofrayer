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

    // Optionally filter by specific membership slug
    const body = await req.json().catch(() => ({}));
    const targetSlug = body?.slug;

    // Get memberships with scrape URLs
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
        console.log(`Scraping benefits for ${membership.name} from ${membership.scrape_url}`);

        // Step 1: Scrape with Firecrawl
        const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: membership.scrape_url,
            formats: ['markdown', 'links'],
            onlyMainContent: true,
          }),
        });

        const scrapeData = await scrapeResponse.json();

        if (!scrapeResponse.ok) {
          console.error(`Failed to scrape ${membership.name}:`, scrapeData);
          results.push({
            membership: membership.name,
            slug: membership.slug,
            status: 'scrape_error',
            error: scrapeData.error || `HTTP ${scrapeResponse.status}`,
          });
          continue;
        }

        const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';

        if (!markdown || markdown.length < 50) {
          results.push({
            membership: membership.name,
            slug: membership.slug,
            status: 'no_content',
            contentLength: markdown.length,
          });
          continue;
        }

        console.log(`Got ${markdown.length} chars for ${membership.name}, sending to AI...`);

        // Step 2: Parse with AI
        const discounts = await parseWithAI(lovableApiKey, markdown, membership);

        if (discounts.length > 0) {
          // Step 3: Upsert into database
          // First deactivate old scraped discounts for this membership
          await supabase
            .from('discounts')
            .update({ is_active: false })
            .eq('membership_id', membership.id)
            .not('scraped_at', 'is', null);

          // Insert new ones
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
                redeem_url: d.redeem_url || membership.website_url || null,
                membership_id: membership.id,
                scraped_at: new Date().toISOString(),
                is_active: true,
              }))
            );

          if (insertError) {
            console.error(`Failed to insert discounts for ${membership.name}:`, insertError);
            results.push({
              membership: membership.name,
              slug: membership.slug,
              status: 'insert_error',
              error: insertError.message,
              discountsFound: discounts.length,
            });
            continue;
          }
        }

        results.push({
          membership: membership.name,
          slug: membership.slug,
          status: 'success',
          discountsFound: discounts.length,
          contentLength: markdown.length,
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

async function parseWithAI(apiKey: string, markdown: string, membership: any): Promise<any[]> {
  // Truncate to avoid token limits
  const truncatedContent = markdown.substring(0, 8000);

  const prompt = `אתה מנתח תוכן של דף הטבות מאתר מועדון "${membership.name}".
חלץ את כל ההנחות וההטבות מהתוכן הבא והחזר אותן כ-JSON array.

כל הנחה צריכה לכלול:
- brand: שם המותג/בית העסק (בעברית)
- title: כותרת ההנחה (קצרה וברורה)
- description: תיאור קצר של ההטבה
- discount_value: ערך ההנחה (לדוגמה: "20%", "1+1", "50₪ הנחה", "חינם")
- category: קטגוריה (אחת מ: אופנה, מזון, בריאות, בידור, חשמל, ספורט, תיירות, רכב, ביטוח, פיננסי, לימודים, כללי)
- location: מיקום אם מצוין (או "כל הארץ")

החזר רק JSON array תקני, ללא טקסט נוסף. אם אין הנחות, החזר [].
דוגמה: [{"brand": "נייקי", "title": "20% הנחה על כל הקולקציה", "description": "הנחה בכל הסניפים", "discount_value": "20%", "category": "אופנה", "location": "כל הארץ"}]

התוכן:
${truncatedContent}`;

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'user', content: prompt }
        ],
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

    // Extract JSON from response (might be wrapped in ```json blocks)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log('No JSON array found in AI response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log(`AI extracted ${parsed.length} discounts for ${membership.name}`);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('AI parsing error:', err);
    return [];
  }
}
