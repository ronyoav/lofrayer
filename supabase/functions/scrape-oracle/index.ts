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

    // ─── Isracard: WebScraping.ai with residential Israeli IP + AI parsing ───
    // benefits.isracard.co.il geo-blocks non-Israeli IPs AND has Cloudflare protection.
    // WebScraping.ai routes through residential Israeli IPs which bypass both.
    const isIsracard = ['iscard', 'isracard', 'isracard-benefits'].includes(membership.slug);
    if (isIsracard) {
      const israUrl = 'https://benefits.isracard.co.il/parentcategories/online-benefits/';
      console.log('Isracard detected — using WebScraping.ai with residential Israeli IP');

      try {
        const params = new URLSearchParams({
          api_key: webscrapingKey,
          url: israUrl,
          country: 'il',
          render_js: '1',
          proxy: 'residential',
          timeout: '45000',
          wait: '5000',
        });

        // Use /html endpoint — /text times out on React SPAs
        console.log('Calling WebScraping.ai /html for Isracard...');
        const wsRes = await fetch(`https://api.webscraping.ai/html?${params.toString()}`, {
          signal: AbortSignal.timeout(55000),
        });

        console.log(`WebScraping.ai status: ${wsRes.status}`);

        if (wsRes.ok) {
          const html = await wsRes.text();
          console.log(`WebScraping.ai /html returned ${html.length} chars for Isracard`);

          if (html.length > 1000) {
            console.log(`Raw HTML: ${html.length} chars`);

            // Direct regex extraction — structure is known: caption-title + caption-sub-title + onclick href
            let discounts = extractIsracardBenefits(html, israUrl);
            console.log(`Direct extraction: ${discounts.length} Isracard discounts`);

            // AI fallback if direct extraction gets nothing
            if (discounts.length === 0) {
              console.log('Direct extraction got 0, falling back to AI...');
              discounts = await parseHtmlWithAI(geminiKey, html, membership);
              console.log(`AI extracted ${discounts.length} Isracard discounts`);
            }

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
                JSON.stringify({ success: true, membership: membership.name, discountsFound: discounts.length, strategy: 'webscraping.ai-direct-extraction' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            return new Response(
              JSON.stringify({ success: false, error: 'No discounts extracted (direct + AI both returned 0)', htmlLength: html.length }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({ success: false, error: 'HTML too short — Cloudflare still blocking?', htmlLength: html.length, htmlPreview: html.substring(0, 300) }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } else {
          const errText = await wsRes.text();
          console.error(`WebScraping.ai error [${wsRes.status}]: ${errText.substring(0, 300)}`);
          return new Response(
            JSON.stringify({ success: false, error: `WebScraping.ai HTTP ${wsRes.status}`, details: errText.substring(0, 300) }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error('WebScraping.ai error:', errMsg);
        return new Response(
          JSON.stringify({ success: false, error: `WebScraping.ai exception: ${errMsg}` }),
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

// ─── HTML Cleaner — strips scripts/styles/head to expose actual content ───

function cleanHtml(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, '')       // Remove <head> entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')   // Remove all <script> blocks
    .replace(/<style[\s\S]*?<\/style>/gi, '')     // Remove all <style> blocks
    .replace(/<!--[\s\S]*?-->/g, '')              // Remove HTML comments
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')         // Remove SVG icons
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '') // Remove noscript blocks
    .replace(/\s{2,}/g, ' ')                      // Collapse whitespace
    .trim();
}

// ─── Isracard direct extractor — parses known caption-title/sub-title structure ───

function extractIsracardBenefits(html: string, baseUrl: string): any[] {
  const discounts: any[] = [];
  const seen = new Set<string>();

  // Each benefit card is an <a> with class "category-item"
  const blockRegex = /<a[^>]+class="[^"]*category-item[^"]*"[^>]*onclick="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(html)) !== null) {
    const onclick = blockMatch[1];
    const inner = blockMatch[2];

    // Title: <div class="... caption-title ...">TEXT</div>
    const titleMatch = inner.match(/class="[^"]*caption-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!titleMatch) continue;
    const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);

    // Brand: <div class="... caption-sub-title ...">TEXT</div>
    const brandMatch = inner.match(/class="[^"]*caption-sub-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const brand = brandMatch ? brandMatch[1].replace(/<[^>]+>/g, '').trim() : title.split('-')[0].trim();

    // Redeem URL: location.href='URL' in onclick
    const urlMatch = onclick.match(/location\.href='([^']+)'/);
    const redeemUrl = urlMatch ? urlMatch[1] : baseUrl;

    // Category: first arg of benefitClick('CATEGORY', ...)
    const catMatch = onclick.match(/benefitClick\('([^']+)'/);
    let category = 'כללי';
    if (catMatch) {
      const raw = catMatch[1];
      if (/אונליין/.test(raw)) category = 'קניות אונליין';
      else if (/אוכל|מסעד/.test(raw)) category = 'מזון';
      else if (/בריאות/.test(raw)) category = 'בריאות';
      else if (/אופנה/.test(raw)) category = 'אופנה';
      else if (/בידור/.test(raw)) category = 'בידור';
      else if (/תיירות|נסיעות/.test(raw)) category = 'תיירות';
      else if (/ספורט/.test(raw)) category = 'ספורט';
    }

    // Discount value: pick the most specific pattern found in the title
    const discountPatterns = [/עד\s*\d+%/, /\d+%/, /\d+\s*₪/, /קאשבק/, /1\+1/];
    let discountValue = 'הטבה';
    for (const pat of discountPatterns) {
      const dm = title.match(pat);
      if (dm) { discountValue = dm[0]; break; }
    }

    discounts.push({ brand, title, description: null, discount_value: discountValue, category, location: 'כל הארץ', redeem_url: redeemUrl });
  }

  return discounts;
}

// ─── AI Parsing (Google Gemini — free tier) ───

async function parseHtmlWithAI(geminiKey: string, html: string, membership: any): Promise<any[]> {
  const cleaned = cleanHtml(html);
  console.log(`HTML cleaned: ${html.length} → ${cleaned.length} chars`);
  const truncatedHtml = cleaned.length > 120000 ? cleaned.substring(0, 120000) : cleaned;

  const prompt = `אתה מנתח תוכן HTML של דף הטבות ומבצעים מאתר "${membership.name}".
חלץ את כל ההטבות, המבצעים וההנחות שאתה מוצא — כולל חנויות, מסעדות, קולנוע, אטרקציות, נסיעות, אופנה, אלקטרוניקה, בריאות.
כל פריט שמוצג עם מותג + תיאור + ערך הנחה הוא הטבה.
גם אם אין אחוז ספציפי — אם יש מוצר/שירות עם הטבה כלשהי, כלול אותו.

לכל הטבה החזר:
- brand: שם המותג/בית העסק (בעברית)
- title: כותרת ההטבה
- description: תיאור קצר
- discount_value: ערך ההנחה (לדוגמה: "20%", "1+1", "50₪ הנחה", "הטבה מיוחדת")
- category: קטגוריה (אופנה, מזון, בריאות, בידור, חשמל, ספורט, תיירות, רכב, ביטוח, פיננסי, לימודים, כללי)
- location: מיקום אם מצוין (או "כל הארץ")
- redeem_url: קישור למימוש אם קיים (או "")

החזר JSON array בלבד, ללא טקסט נוסף לפני או אחרי. אם אין הטבות, החזר [].`;

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
