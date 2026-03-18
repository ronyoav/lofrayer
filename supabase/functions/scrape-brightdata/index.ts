const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BRIGHTDATA_API = 'https://api.brightdata.com/request';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const brightdataKey = Deno.env.get('BRIGHTDATA_API_KEY');
    if (!brightdataKey) {
      return new Response(
        JSON.stringify({ error: 'BRIGHTDATA_API_KEY not configured' }),
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
    const zoneName = body?.zone || 'web_unlocker1';

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
    console.log(`Starting Bright Data scrape for ${membership.name} at ${scrapeUrl}`);

    // Step 1: Fetch page HTML via Bright Data Web Unlocker (Israeli proxy)
    const html = await fetchWithBrightData(brightdataKey, scrapeUrl, zoneName);

    if (!html) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch page via Bright Data' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Got HTML: ${Math.round(html.length / 1024)}KB`);

    // Step 2: Parse HTML with AI to extract discounts
    const discounts = await parseHtmlWithAI(geminiKey, html, membership);
    console.log(`Extracted ${discounts.length} discounts`);

    if (discounts.length > 0) {
      // Deactivate old scraped discounts
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

// ─── Bright Data Web Unlocker ───

async function fetchWithBrightData(apiKey: string, url: string, zone: string): Promise<string | null> {
  try {
    console.log(`Fetching via Bright Data Web Unlocker (zone: ${zone}, country: IL)...`);
    
    const response = await fetch(BRIGHTDATA_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        zone,
        url,
        format: 'raw',
        country: 'il',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Bright Data error [${response.status}]: ${errText}`);
      
      // Try with markdown format as fallback
      console.log('Retrying with markdown format...');
      const retryResponse = await fetch(BRIGHTDATA_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          zone,
          url,
          format: 'raw',
          country: 'il',
          data_format: 'markdown',
        }),
      });

      if (!retryResponse.ok) {
        console.error(`Bright Data retry error [${retryResponse.status}]: ${await retryResponse.text()}`);
        return null;
      }

      return await retryResponse.text();
    }

    return await response.text();
  } catch (err) {
    console.error('Bright Data fetch error:', err);
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
