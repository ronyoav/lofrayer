import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const RATE_LIMIT_MAX = 10; // max requests per IP per minute

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check: require a valid Supabase session JWT or service_role token
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '') ?? '';

    let isAuthorized = false;

    // Check if it's a valid user session
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) {
      isAuthorized = true;
    } else {
      // Check if it's a service_role JWT (Supabase gateway already verified the signature)
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.role === 'service_role') isAuthorized = true;
      } catch {
        // invalid JWT format
      }
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Rate limiting: 10 requests per IP per minute
    // Only use CF-Connecting-IP (set by Cloudflare, cannot be spoofed).
    // X-Forwarded-For is user-controlled and would allow rate limit bypass.
    const clientIp = req.headers.get('CF-Connecting-IP') ?? 'unknown';

    const { data: requestCount } = await supabase.rpc('increment_rate_limit', { p_ip: clientIp });
    if (requestCount > RATE_LIMIT_MAX) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' } }
      );
    }

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');

    const body = await req.json().catch(() => ({}));
    const targetSlug = body?.slug || 'behatzada';
    const testMode = body?.test === true; // ?test=true → scrape only 1 page (for debugging)

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

    // SSRF protection: only allow known Israeli benefit sites
    const ALLOWED_SCRAPE_HOSTS = [
      'behatzada.mod.gov.il', 'benefits.isracard.co.il', 'cal-store.co.il', 'cal-online.co.il',
      'yours.co.il', 'paisplus.co.il', 'www.hever.co.il', 'max.co.il',
      'clubhub.co.il', 'hofesh.co.il', 'clalbit.co.il',
    ];
    try {
      const scrapeHost = new URL(scrapeUrl).hostname;
      if (!ALLOWED_SCRAPE_HOSTS.some(h => scrapeHost === h || scrapeHost.endsWith('.' + h))) {
        return new Response(
          JSON.stringify({ error: `scrape_url host not permitted: ${scrapeHost}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid scrape_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting scrape for ${membership.name} at ${scrapeUrl}`);
    console.log(`isIsracard=${['iscard','isracard','isracard-benefits'].includes(membership.slug)} slug=${membership.slug}`);

    // ─── Isracard: GCP VM Puppeteer-Stealth proxy ───
    // benefits.isracard.co.il geo-blocks non-Israeli IPs AND has Cloudflare protection.
    // The GCP VM (Israeli IP) with Puppeteer-Stealth bypasses both — no credit limits.
    const isIsracard = ['iscard', 'isracard', 'isracard-benefits'].includes(membership.slug);
    if (isIsracard) {
      const israUrls = [
        'https://benefits.isracard.co.il/parentcategories/online-benefits/',
        'https://benefits.isracard.co.il/parentcategories/cinema/',
      ];
      const calProxyUrl = Deno.env.get('CAL_PROXY_URL') || '';
      const calProxyKey = Deno.env.get('CAL_PROXY_KEY') || 'lofrayer-cal-2024';
      console.log('Isracard detected — scraping multiple pages via GCP Puppeteer-Stealth proxy');

      try {
        const allDiscounts: any[] = [];
        const seenTitles = new Set<string>();

        for (const israUrl of israUrls) {
          console.log(`Scraping Isracard page: ${israUrl}`);
          const proxyParams = new URLSearchParams({ key: calProxyKey, url: israUrl });

          const wsRes = await fetch(`${calProxyUrl}/?${proxyParams.toString()}`, {
            signal: AbortSignal.timeout(25000),
          });

          console.log(`GCP proxy status for ${israUrl}: ${wsRes.status}`);

          if (!wsRes.ok) {
            console.error(`Failed to fetch ${israUrl}: HTTP ${wsRes.status}`);
            continue;
          }

          const html = await wsRes.text();
          console.log(`Got ${html.length} chars from ${israUrl}`);

          if (html.length < 1000) {
            console.error(`HTML too short for ${israUrl} — skipping`);
            continue;
          }

          // Direct regex extraction
          let pageDiscounts = extractIsracardBenefits(html, israUrl);
          console.log(`Direct extraction from ${israUrl}: ${pageDiscounts.length} discounts`);

          // AI fallback
          if (pageDiscounts.length === 0) {
            console.log(`Direct got 0 for ${israUrl}, falling back to AI...`);
            pageDiscounts = await parseHtmlWithAI(geminiKey, html, membership);
            console.log(`AI extracted ${pageDiscounts.length} discounts from ${israUrl}`);
          }

          // Deduplicate across pages
          for (const d of pageDiscounts) {
            if (!seenTitles.has(d.title)) {
              seenTitles.add(d.title);
              allDiscounts.push(d);
            }
          }
        }

        console.log(`Total Isracard discounts across all pages: ${allDiscounts.length}`);

        if (allDiscounts.length > 0) {
          await supabase.from('discounts').update({ is_active: false })
            .eq('membership_id', membership.id).not('scraped_at', 'is', null);
          const { error: insertError } = await supabase.from('discounts').insert(
            allDiscounts.map((d: any) => ({
              brand: d.brand || 'ישראכרט',
              title: d.title || '',
              description: d.description || null,
              discount_value: d.discount_value || '',
              category: d.category || 'כללי',
              location: d.location || 'כל הארץ',
              redeem_url: d.redeem_url || israUrls[0],
              membership_id: membership.id,
              scraped_at: new Date().toISOString(),
              is_active: true,
            }))
          );
          if (insertError) {
            console.error('Insert error:', insertError);
            return new Response(
              JSON.stringify({ success: false, error: insertError.message, discountsFound: allDiscounts.length }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({ success: true, membership: membership.name, discountsFound: allDiscounts.length, strategy: 'webscraping.ai-direct-extraction', pages: israUrls.length }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ success: false, error: 'No discounts extracted from any Isracard page' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error('Isracard scrape error:', errMsg);
        return new Response(
          JSON.stringify({ success: false, error: `Isracard exception: ${errMsg}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ─── CAL: multiple product-list pages ───
    const isCal = membership.slug === 'cal' || membership.scrape_url?.includes('cal-store.co.il');
    if (isCal) {
      const allCalUrls = [
        'https://www.cal-store.co.il/productlist.php?cid=B0E087D2-212B-4308-813D-C8693B2563F7',
        'https://www.cal-store.co.il/productlist.php?cid=11FAA02A-199E-4789-B826-4AD4FF5A8994',
        'https://www.cal-store.co.il/productlist.php?cid=6BA2A2E1-768B-47A5-A43C-97B745E0B8F6',
        'https://www.cal-store.co.il/productlist.php?cid=1A680972-97C4-4B2F-9950-37EC7297DA73',
      ];
      // In test mode, only scrape 1 page to verify the pipeline works
      const calUrls = testMode ? allCalUrls.slice(0, 1) : allCalUrls;
      console.log(`CAL mode: ${testMode ? 'TEST (1 page)' : 'FULL (5 pages)'}`);

      console.log(`CAL detected — scraping ${calUrls.length} pages (render_js=0 to bypass MemCyco SDK)`);

      try {
        const allDiscounts: any[] = [];
        const seenTitles = new Set<string>();
        const calPageResults: any[] = [];

        // VM proxy: Israeli IP bypasses MemCyco SDK that blocks WebScraping.ai
        const calProxyUrl = Deno.env.get('CAL_PROXY_URL') || '';
        const calProxyKey = Deno.env.get('CAL_PROXY_KEY') || 'lofrayer-cal-2024';

        // Fetch pages in batches of 2 — avoids overwhelming proxy with 5 concurrent Puppeteer tabs
        console.log(`Fetching ${calUrls.length} CAL pages in batches of 2...`);
        const fetchResults: any[] = [];
        const batchSize = 2;
        for (let i = 0; i < calUrls.length; i += batchSize) {
          const batch = calUrls.slice(i, i + batchSize);
          console.log(`Batch ${Math.floor(i/batchSize)+1}: fetching ${batch.length} pages`);
          const batchResults = await Promise.all(
            batch.map(async (calUrl) => {
              console.log(`Scraping CAL page: ${calUrl}`);
              const proxyEndpoint = `${calProxyUrl}/?key=${calProxyKey}&url=${encodeURIComponent(calUrl)}`;
              try {
                const calRes = await fetch(proxyEndpoint, {
                  signal: AbortSignal.timeout(90000), // 90s per page
                });
                if (!calRes.ok) {
                  console.error(`Failed to fetch CAL page: ${calUrl} — HTTP ${calRes.status}`);
                  return { url: calUrl, status: `http-${calRes.status}`, htmlLength: 0, discounts: [] };
                }
                const pageHtml = await calRes.text();
                console.log(`Got ${pageHtml.length} chars from ${calUrl}`);
                const pageDiscounts = extractCalBenefits(pageHtml, calUrl);
                console.log(`Extracted ${pageDiscounts.length} discounts from ${calUrl}`);
                return { url: calUrl, status: 'ok', htmlLength: pageHtml.length, discounts: pageDiscounts, htmlPreview: pageHtml.substring(0, 300) };
              } catch (err: any) {
                console.error(`Error fetching ${calUrl}: ${err.message}`);
                return { url: calUrl, status: `error: ${err.message}`, htmlLength: 0, discounts: [] };
              }
            })
          );
          fetchResults.push(...batchResults);
        }

        for (const result of fetchResults) {
          calPageResults.push({ url: result.url, status: result.status, htmlLength: result.htmlLength, discounts: result.discounts.length, htmlPreview: result.htmlPreview });
          for (const d of result.discounts) {
            if (!seenTitles.has(d.title)) {
              seenTitles.add(d.title);
              allDiscounts.push({ ...d, redeem_url: d.redeem_url || result.url });
            }
          }
        }

        console.log(`Total CAL discounts across all pages: ${allDiscounts.length}`);

        if (allDiscounts.length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'No discounts extracted from any CAL page', pageResults: calPageResults }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (allDiscounts.length > 0) {
          await supabase.from('discounts').update({ is_active: false })
            .eq('membership_id', membership.id).not('scraped_at', 'is', null);
          const { error: insertError } = await supabase.from('discounts').insert(
            allDiscounts.map((d: any) => ({
              brand: d.brand || 'כאל',
              brand_logo_url: d.brand_logo_url || null,
              title: d.title || '',
              description: d.description || null,
              discount_value: d.discount_value || '',
              category: d.category || 'כללי',
              location: d.location || 'כל הארץ',
              redeem_url: d.redeem_url || membership.scrape_url,
              membership_id: membership.id,
              scraped_at: new Date().toISOString(),
              is_active: true,
            }))
          );
          if (insertError) {
            console.error('Insert error:', insertError);
            return new Response(
              JSON.stringify({ success: false, error: insertError.message, discountsFound: allDiscounts.length }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({ success: true, membership: membership.name, discountsFound: allDiscounts.length, strategy: 'webscraping.ai+ai-multi-page', pages: calUrls.length, ...(testMode && { sampleDiscounts: allDiscounts.slice(0, 3) }) }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error('CAL scrape error:', errMsg);
        return new Response(
          JSON.stringify({ success: false, error: `CAL exception: ${errMsg}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ─── Yours (שלך): 4 category pages, no auth, no bot protection ───
    const isYours = membership.slug === 'yours' || membership.scrape_url?.includes('yours.co.il');
    if (isYours) {
      const allYoursUrls = [
        { url: 'https://yours.co.il/category/866',  category: 'מזון' },
        { url: 'https://yours.co.il/category/753',  category: 'קניות' },
        { url: 'https://yours.co.il/category/1777', category: 'קניות אונליין' },
        { url: 'https://yours.co.il/category/789',  category: 'בידור' },
      ];
      const yoursUrls = testMode ? allYoursUrls.slice(0, 1) : allYoursUrls;
      console.log(`Yours mode: ${testMode ? 'TEST (1 page)' : 'FULL (4 pages)'}`);

      try {
        const allDiscounts: any[] = [];
        const seenTitles = new Set<string>();
        const pageResults: any[] = [];

        const batchSize = 2;
        for (let i = 0; i < yoursUrls.length; i += batchSize) {
          const batch = yoursUrls.slice(i, i + batchSize);
          console.log(`Batch ${Math.floor(i / batchSize) + 1}: fetching ${batch.length} Yours pages`);
          const batchResults = await Promise.all(
            batch.map(async ({ url, category }) => {
              console.log(`Scraping Yours page: ${url}`);
              try {
                const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url, formats: ['html'], location: { country: 'IL', languages: ['he'] }, waitFor: 3000 }),
                  signal: AbortSignal.timeout(55000),
                });
                if (!fcRes.ok) {
                  console.error(`Failed ${url}: HTTP ${fcRes.status}`);
                  return { url, category, status: `http-${fcRes.status}`, htmlLength: 0, discounts: [] };
                }
                const fcData = await fcRes.json();
                const html = fcData.data?.html || fcData.html || '';
                console.log(`Got ${html.length} chars from ${url}`);
                if (html.length < 1000) {
                  console.error(`HTML too short for ${url} — skipping`);
                  return { url, category, status: 'too-short', htmlLength: html.length, discounts: [] };
                }
                const discounts = extractYoursBenefits(html, category);
                console.log(`Extracted ${discounts.length} from ${url}`);
                return { url, category, status: 'ok', htmlLength: html.length, discounts };
              } catch (err: any) {
                console.error(`Error fetching ${url}: ${err.message}`);
                return { url, category, status: `error: ${err.message}`, htmlLength: 0, discounts: [] };
              }
            })
          );
          for (const result of batchResults) {
            pageResults.push({ url: result.url, status: result.status, htmlLength: result.htmlLength, discounts: result.discounts.length });
            for (const d of result.discounts) {
              if (!seenTitles.has(d.title)) {
                seenTitles.add(d.title);
                allDiscounts.push(d);
              }
            }
          }
        }

        console.log(`Total Yours discounts: ${allDiscounts.length}`);

        if (allDiscounts.length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'No discounts extracted from Yours pages', pageResults }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        await supabase.from('discounts').update({ is_active: false })
          .eq('membership_id', membership.id).not('scraped_at', 'is', null);
        const { error: insertError } = await supabase.from('discounts').insert(
          allDiscounts.map((d: any) => ({
            brand: d.brand || 'שלך',
            brand_logo_url: d.brand_logo_url || null,
            title: d.title || '',
            description: null,
            discount_value: d.discount_value || '',
            category: d.category || 'כללי',
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
            JSON.stringify({ success: false, error: insertError.message, discountsFound: allDiscounts.length }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ success: true, membership: membership.name, discountsFound: allDiscounts.length, strategy: 'webscraping.ai-direct-extraction', pages: yoursUrls.length, ...(testMode && { sampleDiscounts: allDiscounts.slice(0, 3) }) }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error('Yours scrape error:', errMsg);
        return new Response(
          JSON.stringify({ success: false, error: `Yours exception: ${errMsg}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ─── PaisPlus (פיס פלוס): 32 category pages, no auth, no bot protection ───
    const isPaisPlus = membership.slug === 'pais' || membership.slug === 'paisplus' || membership.scrape_url?.includes('paisplus.co.il');
    if (isPaisPlus) {
      const allPaisPlusUrls = [
        { url: 'https://paisplus.co.il/category/279',  category: 'קניות' },
        { url: 'https://paisplus.co.il/category/296',  category: 'קניות אונליין' },
        { url: 'https://paisplus.co.il/category/314',  category: 'מזון' },
        { url: 'https://paisplus.co.il/category/1469', category: 'מזון' },
        { url: 'https://paisplus.co.il/category/1510', category: 'מזון' },
        { url: 'https://paisplus.co.il/category/1326', category: 'מזון' },
        { url: 'https://paisplus.co.il/category/1030', category: 'מזון' },
        { url: 'https://paisplus.co.il/category/1616', category: 'מזון' },
        { url: 'https://paisplus.co.il/category/1833', category: 'מזון' },
        { url: 'https://paisplus.co.il/category/284',  category: 'מזון' },
        { url: 'https://paisplus.co.il/category/331',  category: 'מזון' },
        { url: 'https://paisplus.co.il/category/285',  category: 'מזון' },
        { url: 'https://paisplus.co.il/category/373',  category: 'מזון' },
        { url: 'https://paisplus.co.il/category/374',  category: 'מזון' },
        { url: 'https://paisplus.co.il/category/375',  category: 'מזון' },
        { url: 'https://paisplus.co.il/category/1697', category: 'מזון' },
        { url: 'https://paisplus.co.il/category/1738', category: 'מזון' },
        { url: 'https://paisplus.co.il/category/305',  category: 'בידור' },
        { url: 'https://paisplus.co.il/category/304',  category: 'בידור' },
        { url: 'https://paisplus.co.il/category/451',  category: 'בידור' },
        { url: 'https://paisplus.co.il/category/310',  category: 'בידור' },
        { url: 'https://paisplus.co.il/category/306',  category: 'בידור' },
        { url: 'https://paisplus.co.il/category/655',  category: 'בידור' },
        { url: 'https://paisplus.co.il/category/307',  category: 'בידור' },
        { url: 'https://paisplus.co.il/category/282',  category: 'בידור' },
        { url: 'https://paisplus.co.il/category/291',  category: 'בידור' },
        { url: 'https://paisplus.co.il/category/292',  category: 'בידור' },
        { url: 'https://paisplus.co.il/category/337',  category: 'בידור' },
        { url: 'https://paisplus.co.il/category/287',  category: 'בידור' },
      ];
      const paisPlusUrls = testMode ? allPaisPlusUrls.slice(0, 1) : allPaisPlusUrls;
      console.log(`PaisPlus mode: ${testMode ? 'TEST (1 page)' : `FULL (${paisPlusUrls.length} pages)`}`);

      try {
        const allDiscounts: any[] = [];
        const seenTitles = new Set<string>();
        const pageResults: any[] = [];

        const batchSize = 2;
        for (let i = 0; i < paisPlusUrls.length; i += batchSize) {
          const batch = paisPlusUrls.slice(i, i + batchSize);
          console.log(`Batch ${Math.floor(i / batchSize) + 1}: fetching ${batch.length} PaisPlus pages`);
          const batchResults = await Promise.all(
            batch.map(async ({ url, category }) => {
              try {
                // Firecrawl with IL location — bypasses IP block, returns HTML for regex extractor
                const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url, formats: ['markdown'], location: { country: 'IL', languages: ['he'] }, waitFor: 4000 }),
                  signal: AbortSignal.timeout(40000),
                });
                if (!fcRes.ok) {
                  console.error(`Firecrawl failed ${url}: HTTP ${fcRes.status}`);
                  return { url, category, status: `http-${fcRes.status}`, htmlLength: 0, discounts: [] };
                }
                const fcData = await fcRes.json();
                const html = fcData.data?.markdown || fcData.markdown || '';
                console.log(`Got ${html.length} chars from ${url}`);
                if (html.length < 1000) {
                  console.error(`HTML too short for ${url} — skipping`);
                  return { url, category, status: 'too-short', htmlLength: html.length, discounts: [] };
                }
                const discounts = extractPaisPlusBenefits(html, category);
                console.log(`Extracted ${discounts.length} from ${url}`);
                return { url, category, status: 'ok', htmlLength: html.length, discounts };
              } catch (err: any) {
                console.error(`Error fetching ${url}: ${err.message}`);
                return { url, category, status: `error: ${err.message}`, htmlLength: 0, discounts: [] };
              }
            })
          );
          for (const result of batchResults) {
            pageResults.push({ url: result.url, status: result.status, htmlLength: result.htmlLength, discounts: result.discounts.length });
            for (const d of result.discounts) {
              if (!seenTitles.has(d.title)) {
                seenTitles.add(d.title);
                allDiscounts.push(d);
              }
            }
          }
        }

        console.log(`Total PaisPlus discounts: ${allDiscounts.length}`);

        if (allDiscounts.length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'No discounts extracted from PaisPlus pages', pageResults }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        await supabase.from('discounts').update({ is_active: false })
          .eq('membership_id', membership.id).not('scraped_at', 'is', null);
        const { error: insertError } = await supabase.from('discounts').insert(
          allDiscounts.map((d: any) => ({
            brand: d.brand || 'פיס פלוס',
            brand_logo_url: d.brand_logo_url || null,
            title: d.title || '',
            description: null,
            discount_value: d.discount_value || '',
            category: d.category || 'כללי',
            location: d.location || 'כל הארץ',
            redeem_url: d.redeem_url,
            membership_id: membership.id,
            scraped_at: new Date().toISOString(),
            is_active: true,
          }))
        );
        if (insertError) {
          console.error('Insert error:', insertError);
          return new Response(
            JSON.stringify({ success: false, error: insertError.message, discountsFound: allDiscounts.length }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ success: true, membership: membership.name, discountsFound: allDiscounts.length, strategy: 'webscraping.ai-direct-extraction', pages: paisPlusUrls.length, ...(testMode && { sampleDiscounts: allDiscounts.slice(0, 3) }) }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error('PaisPlus scrape error:', errMsg);
        return new Response(
          JSON.stringify({ success: false, error: `PaisPlus exception: ${errMsg}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Firecrawl
    let html = firecrawlKey ? await fetchWithFirecrawl(firecrawlKey, scrapeUrl) : null;
    let strategy = 'firecrawl';

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

// ─── Firecrawl ───

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

// ─── CAL direct extractor — parses cal-store.co.il product list cards ───
// List page structure (categories__text div per product card):
//   <div class="categories__text">
//     <a href="/product.php?pid=UUID&cid=UUID">
//       <h3 class="font-weight-600">TITLE <span>...price info...</span></h3>
//       <p class="d-table-row">DESCRIPTION</p>
//     </a>
//   </div>

function extractCalBenefits(html: string, baseUrl: string): any[] {
  const discounts: any[] = [];
  const seen = new Set<string>();
  const base = 'https://www.cal-store.co.il';

  const blockRegex = /<div[^>]+class="[^"]*categories__text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(html)) !== null) {
    const inner = blockMatch[1];

    const hrefMatch = inner.match(/href="(\/product\.php\?[^"]+)"/i);
    const redeemUrl = hrefMatch ? `${base}${hrefMatch[1]}` : baseUrl;

    const h3Match = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (!h3Match) continue;
    const h3Inner = h3Match[1];

    // Strip all tags → clean readable text e.g. "תו קנייה לרשת BBB החל מ- ₪ 85 במקום ₪ 100"
    const h3Text = h3Inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // Title = everything before "החל מ-" (the price prefix); fallback: strip trailing number
    const beforePriceMatch = h3Text.match(/^([\s\S]+?)\s+החל מ-/);
    const titleRaw = beforePriceMatch
      ? beforePriceMatch[1].trim()
      : h3Text.replace(/\s+\d[\d,]*\s*$/, '').trim();

    if (!titleRaw || seen.has(titleRaw)) continue;
    seen.add(titleRaw);

    // Extract all ₪ prices from h3 text: first = deal price, second = original price
    const h3Prices = [...h3Text.matchAll(/₪\s*([\d,]+)/g)].map(m => m[1]);
    const dealPrice = h3Prices[0] || null;
    const origPrice = h3Prices[1] || null;

    // Image: product card has data-setbg="URL" in a sibling div just before categories__text
    const lookBefore = html.substring(Math.max(0, blockMatch.index - 700), blockMatch.index);
    const bgMatch = lookBefore.match(/data-setbg="([^"]+)"/);
    const imageUrl = bgMatch ? bgMatch[1] : null;

    // Full descriptive title
    let fullTitle = titleRaw;
    if (dealPrice && origPrice) fullTitle = `${titleRaw} ב-₪${dealPrice} במקום ₪${origPrice}`;
    else if (dealPrice) fullTitle = `${titleRaw} ב-₪${dealPrice}`;

    // Discount value: % off when possible
    let discountValue = dealPrice ? `₪${dealPrice}` : 'הטבה';
    if (dealPrice && origPrice) {
      const pct = Math.round((1 - parseInt(dealPrice.replace(',','')) / parseInt(origPrice.replace(',',''))) * 100);
      if (pct > 0) discountValue = `${pct}% הנחה`;
    }

    const descMatch = inner.match(/<p[^>]+class="[^"]*d-table-row[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : null;

    // Brand
    let brand = 'כאל';
    const englishBrand = titleRaw.match(/\b([A-Z][A-Za-z]{1,}(?:\s+[A-Z][A-Za-z]+)*)\b/);
    const afterPrepBrand = titleRaw.match(/(?:לרשת|לאתר|לחנות|למסעדת|למסעד|לפיצרייה|לבית קפה|לקפה|לספא)\s+([^\d\s][^,\n]*?)(?=\s+\d|\s*$)/);
    if (englishBrand) brand = englishBrand[1];
    else if (afterPrepBrand) brand = afterPrepBrand[1].trim();
    else brand = titleRaw.split(/\s+/).slice(0, 2).join(' ') || 'כאל';

    // Category
    let category = 'כללי';
    const text = (titleRaw + ' ' + (description || '')).toLowerCase();
    if (/מסעד|אוכל|קפה|פיצ|שוקו|סושי|המבורג/.test(text)) category = 'מזון';
    else if (/קולנוע|סרט|תיאטרון|הצגה|בידור/.test(text)) category = 'בידור';
    else if (/ספא|קוסמ|יופי|שיער|ניקוי|בריאות|כושר|ספורט/.test(text)) category = 'בריאות';
    else if (/אופנה|ביגוד|נעל|תיק|תכשיט/.test(text)) category = 'אופנה';
    else if (/נסיע|טיסה|מלון|תיירות|חופשה/.test(text)) category = 'תיירות';
    else if (/ילד|משפח|גן|פארק|אטרקצ/.test(text)) category = 'פנאי ומשפחה';
    else if (/תו|קנייה/.test(text)) category = 'קניות';

    discounts.push({ brand, brand_logo_url: imageUrl, title: fullTitle, description, discount_value: discountValue, category, location: 'כל הארץ', redeem_url: redeemUrl });
  }

  return discounts;
}

// ─── Yours (שלך) direct extractor ───
// Card structure: <a class="card-item" href="/product/ID">
//   <img class="card-img" src="URL">
//   <h3 class="card-title">TITLE</h3>
//   <p class="card-sub-title"><p>BRAND</p></p>
//   <div class="card-price">החל מ- 49 ₪</div>

function extractYoursBenefits(html: string, category: string): any[] {
  const discounts: any[] = [];
  const seen = new Set<string>();
  const base = 'https://yours.co.il';

  const blockRegex = /<a[^>]+class="card-item[^"]*"[^>]+href="(\/product\/\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(html)) !== null) {
    const href = match[1];
    const inner = match[2];

    const titleMatch = inner.match(/<h3[^>]+class="card-title"[^>]*>([\s\S]*?)<\/h3>/i);
    if (!titleMatch) continue;
    const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);

    const brandMatch = inner.match(/class="card-sub-title"[^>]*>\s*<p>([\s\S]*?)<\/p>/i);
    const brand = brandMatch ? brandMatch[1].replace(/<[^>]+>/g, '').trim() : 'שלך';

    const imgMatch = inner.match(/src="([^"]+)"[^>]*class="card-img"/i) || inner.match(/class="card-img"[^>]*src="([^"]+)"/i);
    const brand_logo_url = imgMatch ? imgMatch[1] : null;

    const priceMatch = inner.match(/class="card-price"[^>]*>([\s\S]*?)<\/div>/i);
    let discount_value = 'הטבה';
    if (priceMatch) {
      discount_value = priceMatch[1].replace(/<[^>]+>/g, '').replace(/\u200F/g, '').replace(/&nbsp;/g, ' ').trim() || 'הטבה';
    }

    discounts.push({ brand, brand_logo_url, title, discount_value, category, redeem_url: `${base}${href}` });
  }

  return discounts;
}

// ─── PaisPlus (פיס פלוס) direct extractor ───
// Card structure: <a class="card-item regular category-page" href="/product/ID">
//   <img class="card-img" src="URL">
//   <h3 class="card-title">BRAND - TITLE</h3>
//   <p class="card-sub-title">LOCATION</p>
//   <div class="price-text">החל מ-</div><div class="price-number">52 ₪</div>

// Parses Firecrawl markdown output for paisplus.co.il
// Each card in markdown: [![TITLE](IMG_URL)\\\n\\\n**TITLE** \\\n\\\nBRAND \\\n\\\nהחל מ-\\\n\\\nPRICE ₪\\\n\\\nלרכישה](https://paisplus.co.il/product/ID)
function extractPaisPlusBenefits(markdown: string, category: string): any[] {
  const discounts: any[] = [];
  const seen = new Set<string>();

  // Match each markdown link block that points to a product URL
  const blockRegex = /\[([\s\S]*?)\]\(https:\/\/paisplus\.co\.il(\/product\/\d+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(markdown)) !== null) {
    const content = match[1];
    const path = match[2];

    // Must have a bold title — skip nav/menu links
    const titleMatch = content.match(/\*\*([^*]+)\*\*/);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);

    // Image URL
    const imgMatch = content.match(/!\[[^\]]*\]\(([^)]+)\)/);
    const brand_logo_url = imgMatch ? imgMatch[1] : null;

    // Member price: ₪ amount that appears AFTER "החל מ-" (not the face value in title)
    const memberPriceMatch = content.match(/החל מ-[\s\S]*?([\d,]+)\s*₪/);
    const memberPrice = memberPriceMatch ? memberPriceMatch[1] : null;
    const discount_value = memberPrice ? `החל מ- ${memberPrice} ₪` : 'הטבה';

    // Full title includes member price for clarity
    const fullTitle = memberPrice ? `${title} ב-${memberPrice} ₪` : title;

    // Brand: extract from title text — prefer English brand or text after "לרשת ואתר"/"לרשת"/"לאתר"
    let brand = 'פיס פלוס';
    const prepBrand = title.match(/(?:לרשת ואתר|לרשת|לאתר)\s+(.+?)$/);
    const englishBrand = title.match(/\b([A-Z][A-Za-z &]{1,30})\b/);
    if (prepBrand) brand = prepBrand[1].trim();
    else if (englishBrand) brand = englishBrand[1].trim();

    discounts.push({ brand, brand_logo_url, title: fullTitle, discount_value, category, location: 'כל הארץ', redeem_url: `https://paisplus.co.il${path}` });
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
