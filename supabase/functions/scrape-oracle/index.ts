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
    console.log(`Starting WebScraping.ai scrape for ${membership.name} at ${scrapeUrl}`);

    // Step 1: Fetch page HTML via WebScraping.ai with Israeli proxy
    const html = await fetchWithWebScrapingAI(webscrapingKey, scrapeUrl);

    if (!html) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch page via WebScraping.ai' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Got HTML: ${Math.round(html.length / 1024)}KB`);

    // Step 2: Parse HTML with AI to extract discounts
    const discounts = await parseHtmlWithAI(lovableApiKey, html, membership);
    console.log(`Extracted ${discounts.length} discounts`);

    if (discounts.length > 0) {
      // Deactivate old scraped discounts for this membership
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

// ─── WebScraping.ai Fetch (Israeli IP) ───

async function fetchWithWebScrapingAI(apiKey: string, targetUrl: string): Promise<string | null> {
  // Try multiple approaches since behatzada.mod.gov.il has DNS-level geo-blocking
  
  // Approach 1: Use /ai/question endpoint to extract data directly
  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      url: targetUrl,
      question: 'Extract all consumer discounts, benefits and deals shown on this page. For each one provide: brand name, title, description, discount value, category, and any redemption link.',
      country: 'il',
      proxy: 'residential',
    });

    const endpoint = `https://api.webscraping.ai/ai/question?${params.toString()}`;
    console.log('Trying WebScraping.ai /ai/question endpoint');

    const response = await fetch(endpoint);
    console.log(`/ai/question response status: ${response.status}`);

    if (response.ok) {
      const text = await response.text();
      console.log(`Got AI response: ${text.substring(0, 200)}`);
      return text;
    }
    const errText = await response.text();
    console.error(`/ai/question error [${response.status}]: ${errText.substring(0, 300)}`);
  } catch (err) {
    console.error('/ai/question failed:', err);
  }

  // Approach 2: Standard HTML fetch with residential proxy
  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      url: targetUrl,
      country: 'il',
      render_js: '1',
      proxy: 'residential',
      timeout: '45000',
    });

    const endpoint = `https://api.webscraping.ai/html?${params.toString()}`;
    console.log('Trying WebScraping.ai /html endpoint');

    const response = await fetch(endpoint);
    console.log(`/html response status: ${response.status}`);

    const response = await fetch(endpoint, {
      headers: {
        'Accept-Language': 'he-IL,he;q=0.9',
      },
    });

    console.log(`WebScraping.ai response status: ${response.status}`);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`WebScraping.ai error [${response.status}]: ${errText.substring(0, 500)}`);

      // Retry without JS rendering if it times out
      if (response.status === 504 || response.status === 408) {
        console.log('Retrying without JS rendering...');
        const retryParams = new URLSearchParams({
          api_key: apiKey,
          url: targetUrl,
          country: 'il',
          render_js: '0',
          proxy: 'residential',
        });
        const retryResponse = await fetch(`https://api.webscraping.ai/html?${retryParams.toString()}`);
        console.log(`Retry response status: ${retryResponse.status}`);
        if (retryResponse.ok) {
          return await retryResponse.text();
        }
        const retryErr = await retryResponse.text();
        console.error(`Retry error: ${retryErr.substring(0, 500)}`);
      }
      return null;
    }

    const text = await response.text();
    console.log(`Got ${text.length} chars of HTML`);
    return text;
  } catch (err) {
    console.error('WebScraping.ai fetch error:', err);
    return null;
  }
}

// ─── AI Parsing ───

async function parseHtmlWithAI(apiKey: string, html: string, membership: any): Promise<any[]> {
  const truncatedHtml = html.length > 100000 ? html.substring(0, 100000) : html;

  const prompt = `אתה מנתח HTML של דף הטבות מאתר מועדון "${membership.name}".
חלץ את כל ההנחות הצרכניות שאתה מוצא (מותגים, חנויות, מסעדות, קולנוע, חופשות).
אל תכלול מענקים ממשלתיים, תגמולים, סיוע כלכלי או זכאויות.

לכל הנחה:
- brand: שם המותג/בית העסק (בעברית)
- title: כותרת ההנחה (קצרה וברורה)
- description: תיאור קצר
- discount_value: ערך ההנחה (לדוגמה: "20%", "1+1", "50₪ הנחה")
- category: קטגוריה (אופנה, מזון, בריאות, בידור, חשמל, ספורט, תיירות, רכב, ביטוח, פיננסי, לימודים, כללי)
- location: מיקום אם מצוין (או "כל הארץ")
- redeem_url: קישור למימוש ההטבה אם מופיע ב-HTML

החזר רק JSON array תקני, ללא טקסט נוסף. אם אין הנחות, החזר [].`;

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: `${prompt}\n\nHTML content:\n${truncatedHtml}` }],
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
