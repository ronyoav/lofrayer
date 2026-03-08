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

    // Get membership
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

    // Use Browserless to navigate, scroll, and take screenshots
    const screenshots = await captureWithBrowserless(browserlessKey, scrapeUrl);
    console.log(`Captured ${screenshots.length} screenshots`);

    if (screenshots.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No screenshots captured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process each screenshot with AI vision
    const allDiscounts: any[] = [];

    for (let i = 0; i < screenshots.length; i++) {
      console.log(`Processing screenshot ${i + 1}/${screenshots.length}...`);
      const discounts = await parseScreenshotWithAI(lovableApiKey, screenshots[i], membership);
      allDiscounts.push(...discounts);

      // Delay between AI calls
      if (i < screenshots.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Deduplicate by brand+title
    const seen = new Set<string>();
    const uniqueDiscounts = allDiscounts.filter(d => {
      const key = `${d.brand}|${d.title}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`Total unique discounts: ${uniqueDiscounts.length}`);

    if (uniqueDiscounts.length > 0) {
      // Deactivate old scraped discounts
      await supabase
        .from('discounts')
        .update({ is_active: false })
        .eq('membership_id', membership.id)
        .not('scraped_at', 'is', null);

      // Insert new discounts
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

// ─── Browserless: Navigate, scroll, screenshot ───

async function captureWithBrowserless(apiKey: string, url: string): Promise<string[]> {
  const screenshots: string[] = [];

  try {
    // Use Browserless /screenshot endpoint with scrolling script
    // First, get a full page screenshot
    const fullPageScreenshot = await browserlessScreenshot(apiKey, url, {
      fullPage: true,
      waitForTimeout: 5000,
      gotoOptions: { waitUntil: 'networkidle2', timeout: 30000 },
    });

    if (fullPageScreenshot) {
      screenshots.push(fullPageScreenshot);
    }

    // Also try viewport-based screenshots by scrolling
    // Use the /function endpoint to run a script that scrolls and captures
    const scrollScreenshots = await browserlessScrollAndCapture(apiKey, url);
    screenshots.push(...scrollScreenshots);

  } catch (err) {
    console.error('Browserless capture error:', err);
  }

  return screenshots;
}

async function browserlessScreenshot(
  apiKey: string,
  url: string,
  options: { fullPage?: boolean; waitForTimeout?: number; gotoOptions?: any }
): Promise<string | null> {
  try {
    const response = await fetch(`https://chrome.browserless.io/screenshot?token=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        options: {
          fullPage: options.fullPage ?? false,
          type: 'png',
        },
        gotoOptions: options.gotoOptions || { waitUntil: 'networkidle2', timeout: 30000 },
        waitForTimeout: options.waitForTimeout || 3000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Browserless screenshot error: ${response.status}`, errText);
      return null;
    }

    // Response is raw PNG binary
    const buffer = await response.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    
    // Convert to base64
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64 = btoa(binary);
    
    console.log(`Screenshot captured: ${Math.round(base64.length / 1024)}KB`);
    return base64;
  } catch (err) {
    console.error('Screenshot error:', err);
    return null;
  }
}

async function browserlessScrollAndCapture(apiKey: string, url: string): Promise<string[]> {
  try {
    // Use /function endpoint to run a Puppeteer script
    const response = await fetch(`https://chrome.browserless.io/function?token=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `
          module.exports = async ({ page }) => {
            await page.setViewport({ width: 1920, height: 1080 });
            await page.goto('${url}', { waitUntil: 'networkidle2', timeout: 30000 });
            await page.waitForTimeout(3000);

            // Try clicking "show all" buttons
            const showAllSelectors = [
              'button:has-text("הצג הכל")',
              'button:has-text("הצג עוד")',
              'button:has-text("טען עוד")',
              'a:has-text("הצג הכל")',
              '[class*="show-all"]',
              '[class*="load-more"]',
            ];
            
            for (const sel of showAllSelectors) {
              try {
                const btns = await page.$$(sel);
                for (const btn of btns) {
                  await btn.click().catch(() => {});
                }
              } catch(e) {}
            }
            
            await page.waitForTimeout(2000);

            // Scroll down and capture screenshots at intervals
            const screenshots = [];
            const totalHeight = await page.evaluate(() => document.body.scrollHeight);
            const viewportHeight = 1080;
            const scrollSteps = Math.ceil(totalHeight / viewportHeight);
            const maxScreenshots = Math.min(scrollSteps, 5); // Cap at 5 screenshots

            for (let i = 0; i < maxScreenshots; i++) {
              await page.evaluate((y) => window.scrollTo(0, y), i * viewportHeight);
              await page.waitForTimeout(1000);
              const screenshot = await page.screenshot({ encoding: 'base64', type: 'png' });
              screenshots.push(screenshot);
            }

            return { data: screenshots, type: 'application/json' };
          };
        `,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Browserless function error: ${response.status}`, errText);
      return [];
    }

    const result = await response.json();
    const data = result.data || result;
    
    if (Array.isArray(data)) {
      console.log(`Scroll capture: got ${data.length} screenshots`);
      return data.filter((s: any) => typeof s === 'string' && s.length > 100);
    }

    return [];
  } catch (err) {
    console.error('Scroll capture error:', err);
    return [];
  }
}

// ─── AI Vision Parsing ───

async function parseScreenshotWithAI(apiKey: string, screenshotBase64: string, membership: any): Promise<any[]> {
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

  const imageUrl = `data:image/png;base64,${screenshotBase64}`;

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
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
