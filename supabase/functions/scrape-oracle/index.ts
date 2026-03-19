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

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
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

    // ─── Isracard: Browserless on Israeli-IP VM + AI parsing ───
    // benefits.isracard.co.il is a React SPA that geo-blocks non-Israeli IPs.
    // We use the Browserless Docker container running on our Google Cloud VM
    // (zone me-west1-a = Israel) which has a real Israeli IP.
    const isIsracard = ['iscard', 'isracard', 'isracard-benefits'].includes(membership.slug);
    if (isIsracard) {
      const israUrl = 'https://benefits.isracard.co.il/parentcategories/online-benefits/';
      // BROWSERLESS_URL secret is ws://34.165.116.90:80 — convert to http for REST API
      const rawBrowserlessUrl = Deno.env.get('BROWSERLESS_URL') || 'http://34.165.116.90';
      const browserlessBase = rawBrowserlessUrl.replace(/^ws:\/\//, 'http://').replace(/\/$/, '');
      console.log(`Isracard detected — using Browserless at ${browserlessBase} (Israeli IP)`);

      try {
        // Use /content endpoint: runs real Chromium on the VM (Israeli IP), waits for SPA render
        console.log('Calling Browserless /content endpoint...');
        const contentRes = await fetch(`${browserlessBase}/content`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: israUrl,
            waitFor: 8000,
            gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 },
          }),
          signal: AbortSignal.timeout(50000),
        });

        if (contentRes.ok) {
          const html = await contentRes.text();
          console.log(`Browserless /content returned ${html.length} chars for Isracard`);

          if (html.length > 1000) {
            const discounts = await parseHtmlWithAI(geminiKey, html, membership);
            console.log(`AI extracted ${discounts.length} Isracard discounts`);

            if (discounts.length > 0) {
              await supabase.from('discounts').update({ is_active: false })
                .eq('membership_id', membership.id).not('scraped_at', 'is', null);
              const { error: insertError } = await supabase.from('discounts').insert(
                discounts.map((d: any) => ({
                  brand: d.brand || 'ישראכרט',
                  title: d.title || '',
                  description: d.description || null,
                  discount_value: d.discount_value || '',
                  category: d.category || 'כללי',
                  location: d.location || 'כל הארץ',
                  redeem_url: d.redeem_url || israUrl,
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
                JSON.stringify({ success: true, membership: membership.name, discountsFound: discounts.length, strategy: 'browserless-content+ai' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            return new Response(
              JSON.stringify({ success: false, error: 'Browserless got HTML but AI extracted 0 discounts', htmlLength: html.length, htmlPreview: html.substring(0, 500) }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          console.error(`Browserless HTML too short: ${html.length} chars`);
          return new Response(
            JSON.stringify({ success: false, error: 'Browserless HTML too short — still geo-blocked?', htmlLength: html.length, htmlPreview: html.substring(0, 300) }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          const errText = await contentRes.text();
          console.error(`Browserless /content error [${contentRes.status}]: ${errText.substring(0, 300)}`);
          return new Response(
            JSON.stringify({ success: false, error: `Browserless /content HTTP ${contentRes.status}`, details: errText.substring(0, 300) }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error('Browserless error:', errMsg);
        return new Response(
          JSON.stringify({ success: false, error: `Browserless exception: ${errMsg}`, browserlessUrl: browserlessBase }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
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

    const discounts = await parseHtmlWithAI(geminiKey, html, membership);
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

async function fetchWithFirecrawl(apiKey: string, url: string, waitForMs = 5000, onlyMainContent = true): Promise<string | null> {
  try {
    console.log(`Firecrawl scraping ${url} (waitFor: ${waitForMs}ms)`);
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent,
        waitFor: waitForMs,
        location: { country: 'IL', languages: ['he'] },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Firecrawl error [${response.status}]: ${errText.substring(0, 300)}`);
      return null;
    }

    const data = await response.json();
    const markdown = data.data?.markdown || data.markdown || null;
    if (markdown) console.log(`Firecrawl returned ${markdown.length} chars`);
    return markdown;
  } catch (err) {
    console.error('Firecrawl error:', err);
    return null;
  }
}

// ─── AI Parsing (Google Gemini — free tier) ───

async function parseHtmlWithAI(geminiKey: string, html: string, membership: any): Promise<any[]> {
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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${prompt}\n\nContent:\n${truncatedHtml}` }] }],
          generationConfig: { temperature: 0.1 },
        }),
      }
    );

    if (!response.ok) {
      console.error(`Gemini error: ${response.status}`, await response.text());
      return [];
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('AI parsing error:', err);
    return [];
  }
}
