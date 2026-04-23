import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BRAND_LOGOS, MEMBERSHIP_LOGOS } from "@/data/mockData";

export type DbDiscount = {
  id: string;
  brand: string;
  brand_logo_url: string | null;
  title: string;
  description: string | null;
  discount_value: string;
  membership_id: string;
  category: string | null;
  location: string | null;
  redeem_url: string | null;
  is_active: boolean;
  membership: {
    id: string;
    slug: string;
    name: string;
    logo_url: string | null;
  } | null;
};

export type DbMembership = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  color: string | null;
  scrape_url: string | null;
  website_url: string | null;
};

export type DiscountResult = DbDiscount & {
  membership: { id: string; slug: string; name: string; logo_url: string | null } | null;
  brandLogo: string | null;
  membershipName: string;
  membershipLogoUrl: string | null;
};

export function useAllDiscounts() {
  return useQuery({
    queryKey: ["discounts", "all"],
    queryFn: async () => {
      const { data: allMemberships } = await supabase
        .from("memberships")
        .select("id, slug, name, logo_url");

      const membershipMap = Object.fromEntries(
        (allMemberships || []).map((m) => [m.id, m])
      );

      // Paginate to bypass Supabase's 1000-row server-side cap
      const PAGE = 1000;
      let rows: any[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("discounts")
          .select("*")
          .eq("is_active", true)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        rows = rows.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }

      return rows.map((d) => ({
        ...d,
        membership: membershipMap[d.membership_id] || null,
        brandLogo: BRAND_LOGOS[d.brand] || d.brand_logo_url || null,
        membershipName: (() => {
          const name = membershipMap[d.membership_id]?.name || "";
          return name.startsWith("פועלים Wonder") ? "פועלים Wonder" : name;
        })(),
        membershipLogoUrl:
          MEMBERSHIP_LOGOS[membershipMap[d.membership_id]?.slug || ""] ||
          membershipMap[d.membership_id]?.logo_url ||
          null,
      })) as DiscountResult[];
    },
  });
}

export function useDiscounts(membershipSlugs: string[]) {
  return useQuery({
    queryKey: ["discounts", membershipSlugs],
    queryFn: async () => {
      // Expand poalim-wonder to include its sub-memberships (food, movies)
      const expandedSlugs = membershipSlugs.flatMap((slug) =>
        slug === "poalim-wonder"
          ? ["poalim-wonder", "poalim-wonder-food", "poalim-wonder-movies"]
          : [slug]
      );

      // First get membership IDs from slugs
      const { data: memberships, error: membershipsError } = await supabase
        .from("memberships")
        .select("id, slug, name, logo_url")
        .in("slug", expandedSlugs);

      if (membershipsError) throw membershipsError;
      if (!memberships || memberships.length === 0) return [];

      const membershipIds = memberships.map((m) => m.id);
      const membershipMap = Object.fromEntries(
        memberships.map((m) => [m.id, m])
      );

      const { data: discounts, error } = await supabase
        .from("discounts")
        .select("*")
        .in("membership_id", membershipIds)
        .eq("is_active", true);

      if (error) throw error;

      return (discounts || []).map((d) => ({
        ...d,
        membership: membershipMap[d.membership_id] || null,
        // Use local brand logo if available, otherwise DB logo
        brandLogo: BRAND_LOGOS[d.brand] || d.brand_logo_url || null,
        membershipName: (() => {
          const name = membershipMap[d.membership_id]?.name || "";
          return name.startsWith('פועלים Wonder') ? 'פועלים Wonder' : name;
        })(),
        membershipLogoUrl: MEMBERSHIP_LOGOS[membershipMap[d.membership_id]?.slug || ""] || membershipMap[d.membership_id]?.logo_url || null,
      }));
    },
    enabled: membershipSlugs.length > 0,
  });
}

export function useMemberships() {
  return useQuery({
    queryKey: ["memberships"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("memberships")
        .select("*")
        .order("name");
      if (error) throw error;

      // Group Poalim Wonder sub-memberships under one entry
      const filtered = (data as DbMembership[]).filter(
        (m) => !['poalim-wonder-food', 'poalim-wonder-movies'].includes(m.slug)
      );
      return filtered;
    },
  });
}
