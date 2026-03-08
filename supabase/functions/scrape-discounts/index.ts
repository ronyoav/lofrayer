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
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all memberships with scrape URLs
    const { data: memberships, error: membershipError } = await supabase
      .from('memberships')
      .select('*')
      .not('scrape_url', 'is', null);

    if (membershipError) {
      throw new Error(`Failed to fetch memberships: ${membershipError.message}`);
    }

    const results: any[] = [];

    for (const membership of memberships || []) {
      try {
        console.log(`Scraping benefits for ${membership.name} from ${membership.scrape_url}`);

        // Scrape the membership benefits page
        const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: membership.scrape_url,
            formats: ['markdown'],
            onlyMainContent: true,
          }),
        });

        const scrapeData = await scrapeResponse.json();

        if (!scrapeResponse.ok) {
          console.error(`Failed to scrape ${membership.name}:`, scrapeData);
          results.push({
            membership: membership.name,
            status: 'error',
            error: scrapeData.error || `HTTP ${scrapeResponse.status}`,
          });
          continue;
        }

        const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';

        // Try to extract discount-like patterns from the scraped content
        // This is a basic extraction - can be improved with AI/LLM parsing
        const discountPatterns = extractDiscounts(markdown, membership);

        if (discountPatterns.length > 0) {
          // Upsert scraped discounts
          const { error: insertError } = await supabase
            .from('discounts')
            .upsert(
              discountPatterns.map(d => ({
                ...d,
                membership_id: membership.id,
                scraped_at: new Date().toISOString(),
                is_active: true,
              })),
              { onConflict: 'id' }
            );

          if (insertError) {
            console.error(`Failed to insert discounts for ${membership.name}:`, insertError);
          }
        }

        results.push({
          membership: membership.name,
          status: 'success',
          discountsFound: discountPatterns.length,
          contentLength: markdown.length,
        });
      } catch (err) {
        console.error(`Error scraping ${membership.name}:`, err);
        results.push({
          membership: membership.name,
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

// Basic discount extraction from markdown
function extractDiscounts(markdown: string, membership: any) {
  const discounts: any[] = [];
  
  // Look for percentage patterns like "20% הנחה" or price patterns
  const lines = markdown.split('\n').filter(l => l.trim());
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const percentMatch = line.match(/(\d+)%\s*(הנחה|discount)/i);
    const priceMatch = line.match(/(\d+)[₪\$]\s*(במקום|instead)/i);
    
    if (percentMatch || priceMatch) {
      const value = percentMatch ? `${percentMatch[1]}%` : `${priceMatch![1]}₪`;
      
      // Try to extract brand name from surrounding context
      const contextLines = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
      
      discounts.push({
        brand: extractBrandName(contextLines) || 'לא ידוע',
        title: line.trim().substring(0, 200),
        description: contextLines.substring(0, 500),
        discount_value: value,
        category: guessCategory(contextLines),
        location: 'כל הארץ',
        redeem_url: membership.website_url,
      });
    }
  }

  return discounts;
}

function extractBrandName(text: string): string | null {
  // Common Israeli brand patterns - this would be improved with AI
  const brands = ['נייקי', 'אדידס', 'קסטרו', 'FOX', 'גולף', 'רנואר', 'מקדונלד', 'סופר-פארם', 'שופרסל', 'אייס', 'פיצה האט', 'סינמה סיטי', 'הולמס פלייס', 'זארה', 'H&M', 'ZARA', 'Nike', 'Adidas'];
  
  for (const brand of brands) {
    if (text.includes(brand)) return brand;
  }
  return null;
}

function guessCategory(text: string): string {
  const categories: Record<string, string[]> = {
    'אופנה': ['אופנה', 'ביגוד', 'הלבשה', 'נעליים', 'חולצה', 'מכנס'],
    'מזון': ['מזון', 'מסעדה', 'אוכל', 'פיצה', 'המבורגר', 'סופרמרקט'],
    'בריאות': ['בריאות', 'תרופות', 'טיפוח', 'קוסמטיקה', 'בית מרקחת'],
    'בידור': ['קולנוע', 'סרט', 'הצגה', 'בידור', 'כרטיס'],
    'חשמל': ['חשמל', 'מוצרי חשמל', 'אלקטרוניקה', 'מחשב'],
    'ספורט': ['ספורט', 'כושר', 'חדר כושר', 'שחייה'],
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(k => text.includes(k))) return category;
  }
  return 'כללי';
}
