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
    const webscrapingKey = Deno.env.get('WEBSCRAPING_AI_KEY');
    if (!webscrapingKey) {
      return new Response(
        JSON.stringify({ error: 'WEBSCRAPING_AI_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const targetSlug = body?.slug || 'behatzada';

    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('*')
      .eq('slug', targetSlug)
      .single();

    if (membershipError || !membership) {
      return new Response(
        JSON.stringify({ error: `Membership not found: ${targetSlug}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const scrapeUrl = membership.scrape_url || 'https://behatzada.mod.gov.il/benefits';
    console.log(`Starting scrape for ${membership.name} at ${scrapeUrl}`);

    // ─── Isracard: direct window.epi JSON extraction ───
    const isIsracard = ['iscard', 'isracard', 'isracard-benefits'].includes(membership.slug);
    if (isIsracard) {
      console.log('Isracard detected — using window.epi direct extraction');
      // Try direct fetch first (no proxy needed, site is public)
      // then Firecrawl as fallback. WebScraping.ai gets 403 from this site.
      const israHtml = await fetchIsracardDirect() ||
        await fetchWithFirecrawlHtml(Deno.env.get('FIRECRAWL_API_KEY') || '', 'https://benefits.isracard.co.il/');
      if (israHtml) {
        const discounts = extractIsracardBenefits(israHtml, membership);
        console.log(`Extracted ${discounts.length} Isracard discounts`);
        if (discounts.length > 0) {
          await supabase.from('discounts').update({ is_active: false })
            .eq('membership_id', membership.id).not('scraped_at', 'is', null);
          const { error: insertError } = await supabase.from('discounts').insert(
            discounts.map((d: any) => ({
              brand: d.brand,
              title: d.title,
              description: d.description || null,
              discount_value: d.discount_value,
              category: d.category,
              location: 'כל הארץ',
              redeem_url: d.redeem_url,
              membership_id: membership.id,
              scraped_at: new Date().toISOString(),
              is_active: true,
            }))
          );
          if (insertError) {
            console.error('Insert error:', insertError);
            return new Response(
              JSON.stringify({ success: false, error: insertError.message, discountsFound: discounts.length }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({ success: true, membership: membership.name, discountsFound: discounts.length, strategy: 'window.epi' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
      console.log('window.epi extraction failed, falling back to generic scraper');
    }

    // Try WebScraping.ai first, then Firecrawl as fallback
    let html = await fetchWithWebScrapingAI(webscrapingKey, scrapeUrl);
    let strategy = 'webscraping.ai';

    if (!html) {
      // Fallback: try Firecrawl
      const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
      if (firecrawlKey) {
        console.log('Falling back to Firecrawl...');
        html = await fetchWithFirecrawl(firecrawlKey, scrapeUrl);
        strategy = 'firecrawl';
      }
    }

    if (!html) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch page (all strategies failed)' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Got content via ${strategy}: ${Math.round(html.length / 1024)}KB`);

    const discounts = await parseHtmlWithAI(lovableApiKey, html, membership);
    console.log(`Extracted ${discounts.length} discounts`);

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
            brand: d.brand || 'לא ידוע',
            title: d.title || '',
            description: d.description || null,
            discount_value: d.discount_value || '',
            category: d.category || 'כללי',
            location: d.location || 'כל הארץ',
            redeem_url: d.redeem_url || scrapeUrl,
            membership_id: membership.id,
            scraped_at: new Date().toISOString(),
            is_active: true,
          }))
        );

      if (insertError) {
        console.error('Insert error:', insertError);
        return new Response(
          JSON.stringify({ success: false, error: insertError.message, discountsFound: discounts.length }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        membership: membership.name,
        discountsFound: discounts.length,
        strategy,
        htmlSize: `${Math.round(html.length / 1024)}KB`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Scrape error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ─── WebScraping.ai (Israeli residential proxy) ───

async function fetchWithWebScrapingAI(apiKey: string, targetUrl: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      url: targetUrl,
      country: 'il',
      render_js: '1',
      proxy: 'residential',
      timeout: '45000',
    });

    console.log('Trying WebScraping.ai /html with residential IL proxy...');
    const response = await fetch(`https://api.webscraping.ai/html?${params.toString()}`);
    console.log(`WebScraping.ai status: ${response.status}`);

    if (response.ok) {
      const text = await response.text();
      console.log(`WebScraping.ai returned ${text.length} chars`);
      return text;
    }

    const errText = await response.text();
    console.error(`WebScraping.ai error [${response.status}]: ${errText.substring(0, 500)}`);

    // Retry without JS rendering on timeout
    if (response.status === 504 || response.status === 408) {
      console.log('Retrying without JS rendering...');
      params.set('render_js', '0');
      const retry = await fetch(`https://api.webscraping.ai/html?${params.toString()}`);
      if (retry.ok) return await retry.text();
      console.error(`Retry failed [${retry.status}]`);
    }

    return null;
  } catch (err) {
    console.error('WebScraping.ai error:', err);
    return null;
  }
}

// ─── Firecrawl fallback ───

async function fetchWithFirecrawl(apiKey: string, url: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 5000,
        location: { country: 'IL', languages: ['he'] },
      }),
    });

    if (!response.ok) {
      console.error(`Firecrawl error [${response.status}]`);
      return null;
    }

    const data = await response.json();
    return data.data?.markdown || data.markdown || null;
  } catch (err) {
    console.error('Firecrawl error:', err);
    return null;
  }
}

// ─── Isracard: direct fetch (no proxy, site is publicly accessible) ───

async function fetchIsracardDirect(): Promise<string | null> {
  try {
    console.log('Trying direct fetch for Isracard...');
    const res = await fetch('https://benefits.isracard.co.il/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8',
      },
    });
    console.log(`Direct fetch status: ${res.status}`);
    if (res.ok) {
      const html = await res.text();
      if (html.includes('window.epi')) return html;
      console.log('Direct fetch OK but window.epi not found (SSR not included)');
    }
    return null;
  } catch (err) {
    console.error('Direct fetch error:', err);
    return null;
  }
}

// ─── Firecrawl HTML fetch (returns raw HTML, not markdown) ───

async function fetchWithFirecrawlHtml(apiKey: string, url: string): Promise<string | null> {
  if (!apiKey) return null;
  try {
    console.log('Trying Firecrawl for Isracard HTML...');
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        formats: ['rawHtml'],
        waitFor: 4000,
        location: { country: 'IL', languages: ['he'] },
      }),
    });
    if (!res.ok) { console.error(`Firecrawl HTML error: ${res.status}`); return null; }
    const data = await res.json();
    const html: string = data.data?.rawHtml || data.rawHtml || '';
    if (html.includes('window.epi')) return html;
    console.log('Firecrawl returned HTML but window.epi not found');
    return null;
  } catch (err) {
    console.error('Firecrawl HTML error:', err);
    return null;
  }
}

// ─── Isracard: extract window.epi JSON from HTML ───

function extractIsracardBenefits(html: string, membership: any): any[] {
  try {
    // Find window.epi = { ... } in the script tag
    const startIdx = html.indexOf('window.epi = ');
    if (startIdx < 0) {
      console.error('window.epi not found in HTML');
      return [];
    }
    const jsonStart = html.indexOf('{', startIdx);
    // Walk forward counting braces to find the matching closing brace
    let depth = 0;
    let i = jsonStart;
    while (i < html.length) {
      const ch = html[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
      i++;
    }
    const jsonStr = html.substring(jsonStart, i + 1);
    const epi = JSON.parse(jsonStr);
    const benefits: any[] = epi?.CurrentPage?.Benefits || [];
    console.log(`window.epi has ${benefits.length} benefits`);

    const CATEGORY_MAP: Record<string, string> = {
      'מומלצות': 'כללי',
      'נוסעים לחו"ל': 'תיירות',
      'הטבות אונליין': 'כללי',
      'כרטיס Top': 'כללי',
      'אטרקציות': 'בידור',
      'קולנוע': 'בידור',
      'הורים וילדים': 'כללי',
      'בילוי ופנאי': 'בידור',
      'הטבות נתב"ג': 'תיירות',
    };

    return benefits
      .filter((b: any) => !b.OutOfStock && b.MobileBenefitName)
      .map((b: any) => {
        const name: string = b.MobileBenefitName || '';
        const brand: string = b.MobileDescription || b.TitlePart1 || name.split(' ').slice(-1)[0];
        const discountValue = extractDiscountFromName(name);
        const israCategory = b.Category?.Name || '';
        const category = CATEGORY_MAP[israCategory] || 'כללי';
        const link: string = b.LinkUrl || '';
        const redeemUrl = link.startsWith('http')
          ? link
          : link ? `https://benefits.isracard.co.il${link}` : 'https://benefits.isracard.co.il/';
        // Strip HTML from description
        const desc = (b.BenefitPageDescText || '')
          .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300) || null;
        return { brand, title: name, description: desc, discount_value: discountValue, category, redeem_url: redeemUrl };
      });
  } catch (err) {
    console.error('extractIsracardBenefits error:', err);
    return [];
  }
}

function extractDiscountFromName(name: string): string {
  const pct = name.match(/(\d+)\s*%/);
  if (pct) return `${pct[1]}%`;
  const shekel = name.match(/(\d+)\s*₪/);
  if (shekel) return `${shekel[1]}₪`;
  const dollar = name.match(/(\d+)\s*\$/);
  if (dollar) return `${dollar[1]}$`;
  const plus = name.match(/(\d)\+(\d)/);
  if (plus) return `${plus[1]}+${plus[2]}`;
  if (/חינם/.test(name)) return 'חינם';
  return name.substring(0, 25);
}

// ─── AI Parsing ───

async function parseHtmlWithAI(apiKey: string, html: string, membership: any): Promise<any[]> {
  const truncatedHtml = html.length > 100000 ? html.substring(0, 100000) : html;

  const prompt = `אתה מנתח תוכן של דף הטבות מאתר מועדון "${membership.name}".
חלץ את כל ההנחות הצרכניות שאתה מוצא (מותגים, חנויות, מסעדות, קולנוע, חופשות).
אל תכלול מענקים ממשלתיים, תגמולים, סיוע כלכלי או זכאויות.

לכל הנחה:
- brand: שם המותג/בית העסק (בעברית)
- title: כותרת ההנחה (קצרה וברורה)
- description: תיאור קצר
- discount_value: ערך ההנחה (לדוגמה: "20%", "1+1", "50₪ הנחה")
- category: קטגוריה (אופנה, מזון, בריאות, בידור, חשמל, ספורט, תיירות, רכב, ביטוח, פיננסי, לימודים, כללי)
- location: מיקום אם מצוין (או "כל הארץ")
- redeem_url: קישור למימוש ההטבה אם מופיע

החזר רק JSON array תקני, ללא טקסט נוסף. אם אין הנחות, החזר [].`;

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: `${prompt}\n\nContent:\n${truncatedHtml}` }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error(`AI error: ${response.status}`, await response.text());
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('AI parsing error:', err);
    return [];
  }
}
