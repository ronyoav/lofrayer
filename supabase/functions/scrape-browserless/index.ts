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
    const browserlessKey = Deno.env.get('BROWSERLESS_API_KEY');
    if (!browserlessKey) {
      return new Response(
        JSON.stringify({ error: 'BROWSERLESS_API_KEY not configured' }),
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
    console.log(`Starting Browserless scrape for ${membership.name} at ${scrapeUrl}`);

    // Strategy 1: Try /unblock API (best for anti-bot sites)
    let screenshots = await captureWithUnblock(browserlessKey, scrapeUrl);
    
    // Strategy 2: Full page screenshot
    if (screenshots.length === 0) {
      console.log('Unblock failed, trying direct screenshot...');
      screenshots = await captureDirectScreenshot(browserlessKey, scrapeUrl);
    }

    // Strategy 3: /function with scroll captures
    if (screenshots.length === 0) {
      console.log('Direct screenshot failed, trying function with scroll...');
      screenshots = await captureWithFunction(browserlessKey, scrapeUrl);
    }

    console.log(`Total screenshots captured: ${screenshots.length}`);

    if (screenshots.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No screenshots captured from any strategy' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process screenshots with AI vision
    const allDiscounts: any[] = [];
    for (let i = 0; i < screenshots.length; i++) {
      console.log(`Processing screenshot ${i + 1}/${screenshots.length}...`);
      const discounts = await parseScreenshotWithAI(geminiKey, screenshots[i], membership);
      allDiscounts.push(...discounts);
      if (i < screenshots.length - 1) await new Promise(r => setTimeout(r, 1000));
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniqueDiscounts = allDiscounts.filter(d => {
      const key = `${d.brand}|${d.title}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`Total unique discounts: ${uniqueDiscounts.length}`);

    if (uniqueDiscounts.length > 0) {
      await supabase
        .from('discounts')
        .update({ is_active: false })
        .eq('membership_id', membership.id)
        .not('scraped_at', 'is', null);

      const { error: insertError } = await supabase
        .from('discounts')
        .insert(
          uniqueDiscounts.map((d: any) => ({
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
          JSON.stringify({ success: false, error: insertError.message, discountsFound: uniqueDiscounts.length }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        membership: membership.name,
        screenshotsCaptured: screenshots.length,
        discountsFound: uniqueDiscounts.length,
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

const BROWSERLESS_BASE = 'https://production-sfo.browserless.io';

// ─── Strategy 1: /unblock API (bypasses anti-bot) ───

async function captureWithUnblock(apiKey: string, url: string): Promise<string[]> {
  try {
    console.log('Trying /unblock API...');
    const response = await fetch(`${BROWSERLESS_BASE}/unblock?token=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        browserWSEndpoint: false,
        screenshot: true,
        ttl: 30000,
        waitForTimeout: 5000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Unblock error: ${response.status}`, errText);
      return [];
    }

    const data = await response.json();
    console.log(`Unblock response keys: ${Object.keys(data).join(', ')}`);
    
    if (data.screenshot) {
      console.log(`Unblock screenshot: ${Math.round(data.screenshot.length / 1024)}KB`);
      return [data.screenshot];
    }
    
    return [];
  } catch (err) {
    console.error('Unblock error:', err);
    return [];
  }
}

// ─── Strategy 2: Direct /screenshot ───

async function captureDirectScreenshot(apiKey: string, url: string): Promise<string[]> {
  try {
    console.log('Trying /screenshot API...');
    const response = await fetch(`${BROWSERLESS_BASE}/screenshot?token=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        options: { fullPage: true, type: 'png' },
        gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 },
        waitForTimeout: 5000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Screenshot error: ${response.status}`, errText);
      return [];
    }

    const buffer = await response.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    console.log(`Direct screenshot: ${Math.round(base64.length / 1024)}KB`);
    return base64.length > 1000 ? [base64] : [];
  } catch (err) {
    console.error('Screenshot error:', err);
    return [];
  }
}

// ─── Strategy 3: /function with scrolling ───

async function captureWithFunction(apiKey: string, url: string): Promise<string[]> {
  try {
    console.log('Trying /function API with scroll...');
    const code = `
module.exports = async ({ page }) => {
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('${url}', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForTimeout(5000);
  
  // Click show-all buttons
  try {
    const buttons = await page.$$('button, a');
    for (const btn of buttons) {
      const text = await btn.evaluate(el => el.textContent || '');
      if (text.includes('הצג הכל') || text.includes('הצג עוד') || text.includes('טען עוד')) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    }
  } catch(e) {}
  
  await page.waitForTimeout(2000);
  
  const screenshots = [];
  const totalHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportHeight = 1080;
  const steps = Math.min(Math.ceil(totalHeight / viewportHeight), 5);
  
  for (let i = 0; i < steps; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * viewportHeight);
    await page.waitForTimeout(1500);
    const shot = await page.screenshot({ encoding: 'base64', type: 'png' });
    screenshots.push(shot);
  }
  
  return { data: screenshots, type: 'application/json' };
};`;

    const response = await fetch(`${BROWSERLESS_BASE}/function?token=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Function error: ${response.status}`, errText);
      return [];
    }

    const result = await response.json();
    const data = result.data || result;
    if (Array.isArray(data)) {
      const valid = data.filter((s: any) => typeof s === 'string' && s.length > 1000);
      console.log(`Function scroll: got ${valid.length} screenshots`);
      return valid;
    }
    return [];
  } catch (err) {
    console.error('Function error:', err);
    return [];
  }
}

// ─── Helpers ───

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const uint8 = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// ─── AI Vision (Google Gemini — free tier) ───

async function parseScreenshotWithAI(geminiKey: string, screenshotBase64: string, membership: any): Promise<any[]> {
  const prompt = `אתה מנתח צילום מסך של דף הטבות מאתר מועדון "${membership.name}".
חלץ את כל ההנחות הצרכניות שאתה רואה (מותגים, חנויות, מסעדות, קולנוע, חופשות).
אל תכלול מענקים ממשלתיים, תגמולים, סיוע כלכלי או זכאויות.

לכל הנחה:
- brand: שם המותג/בית העסק (בעברית)
- title: כותרת ההנחה (קצרה וברורה)
- description: תיאור קצר
- discount_value: ערך ההנחה (לדוגמה: "20%", "1+1", "50₪ הנחה")
- category: קטגוריה (אופנה, מזון, בריאות, בידור, חשמל, ספורט, תיירות, רכב, ביטוח, פיננסי, לימודים, כללי)
- location: מיקום אם מצוין (או "כל הארץ")

החזר רק JSON array תקני, ללא טקסט נוסף. אם אין הנחות, החזר [].`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'image/png', data: screenshotBase64 } },
            ],
          }],
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
