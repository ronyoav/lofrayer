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
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { images, membership_slug, category_hint } = await req.json();
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: 'No images provided' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get membership
    const { data: membership } = await supabase
      .from('memberships')
      .select('*')
      .eq('slug', membership_slug)
      .single();

    if (!membership) {
      return new Response(JSON.stringify({ error: 'Membership not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const allDiscounts: any[] = [];

    for (let i = 0; i < images.length; i++) {
      const imageBase64 = images[i];
      console.log(`Processing image ${i + 1}/${images.length}...`);

      const prompt = `אתה מנתח צילום מסך של דף הטבות מאתר מועדון "${membership.name}".
${category_hint ? `הקטגוריה הצפויה: ${category_hint}` : ''}

חלץ את כל ההנחות/מוצרים שאתה רואה בצילום. לכל הנחה:
- brand: שם המותג/בית העסק (בעברית)
- title: כותרת ההנחה/מוצר (קצרה וברורה, כולל פרטי המוצר)
- description: תיאור נוסף אם יש
- discount_value: המחיר או ערך ההנחה כפי שמופיע (לדוגמה: "95₪", "ב-65₪", "1+1", "20% הנחה")
- category: קטגוריה (אופנה, מזון, בריאות, בידור, חשמל, ספורט, תיירות, רכב, ביטוח, פיננסי, לימודים, בית, ריהוט, כללי)
- location: מיקום אם מצוין (או "כל הארץ")

אל תכלול פרסומות/באנרים (כמו IBI SMART, הפניקס, קרפור, היינקן).
אל תכלול כפילויות.
החזר רק JSON array תקני, ללא טקסט נוסף. אם אין הנחות, החזר [].`;

      const imageUrl = imageBase64.startsWith('http')
        ? imageBase64
        : `data:image/png;base64,${imageBase64}`;

      try {
        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${lovableApiKey}`, 'Content-Type': 'application/json' },
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
          console.error(`AI error for image ${i + 1}:`, await response.text());
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed)) {
            allDiscounts.push(...parsed);
          }
        }
      } catch (err) {
        console.error(`Error processing image ${i + 1}:`, err);
      }

      // Small delay between API calls
      if (i < images.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    console.log(`Total discounts extracted: ${allDiscounts.length}`);

    if (allDiscounts.length > 0) {
      // Deactivate old scraped discounts for this membership
      await supabase
        .from('discounts')
        .update({ is_active: false })
        .eq('membership_id', membership.id)
        .not('scraped_at', 'is', null);

      const { error: insertError } = await supabase
        .from('discounts')
        .insert(
          allDiscounts.map((d: any) => ({
            brand: d.brand || 'לא ידוע',
            title: d.title || '',
            description: d.description || null,
            discount_value: d.discount_value || '',
            category: d.category || 'כללי',
            location: d.location || 'כל הארץ',
            redeem_url: membership.scrape_url || membership.website_url || null,
            membership_id: membership.id,
            scraped_at: new Date().toISOString(),
            is_active: true,
          }))
        );

      if (insertError) {
        console.error('Insert error:', insertError);
        return new Response(JSON.stringify({ error: insertError.message, discountsFound: allDiscounts.length }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, discountsFound: allDiscounts.length, discounts: allDiscounts }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
