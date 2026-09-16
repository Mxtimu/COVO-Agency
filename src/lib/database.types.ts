export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      affiliate_links: {
        Row: {
          brand_slug: string | null
          campaign_id: string
          created_at: string | null
          creator_id: string
          creator_username: string | null
          destination_url: string | null
          discount_code: string | null
          id: string
          product_id: string | null
          slug: string
        }
        Insert: {
          brand_slug?: string | null
          campaign_id: string
          created_at?: string | null
          creator_id: string
          creator_username?: string | null
          destination_url?: string | null
          discount_code?: string | null
          id?: string
          product_id?: string | null
          slug: string
        }
        Update: {
          brand_slug?: string | null
          campaign_id?: string
          created_at?: string | null
          creator_id?: string
          creator_username?: string | null
          destination_url?: string | null
          discount_code?: string | null
          id?: string
          product_id?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_links_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_links_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_profiles: {
        Row: {
          bio: string | null
          company_name: string | null
          created_at: string | null
          id: string
          industry: string | null
          logo_url: string | null
          onboarding_complete: boolean
          updated_at: string | null
          website: string | null
        }
        Insert: {
          bio?: string | null
          company_name?: string | null
          created_at?: string | null
          id: string
          industry?: string | null
          logo_url?: string | null
          onboarding_complete?: boolean
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          bio?: string | null
          company_name?: string | null
          created_at?: string | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          onboarding_complete?: boolean
          updated_at?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_applications: {
        Row: {
          campaign_id: string
          created_at: string | null
          creator_id: string
          id: string
          note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string | null
          creator_id: string
          id?: string
          note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string | null
          creator_id?: string
          id?: string
          note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_applications_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_applications_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_escrow: {
        Row: {
          balance: number
          brand_id: string
          campaign_id: string
          created_at: string | null
          id: string
          low_balance_notified_at: string | null
          status: string
          total_deposited: number
          total_paid_out: number
          updated_at: string | null
        }
        Insert: {
          balance?: number
          brand_id: string
          campaign_id: string
          created_at?: string | null
          id?: string
          low_balance_notified_at?: string | null
          status?: string
          total_deposited?: number
          total_paid_out?: number
          updated_at?: string | null
        }
        Update: {
          balance?: number
          brand_id?: string
          campaign_id?: string
          created_at?: string | null
          id?: string
          low_balance_notified_at?: string | null
          status?: string
          total_deposited?: number
          total_paid_out?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_escrow_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_escrow_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          brand_id: string
          commission_rate: number
          created_at: string | null
          description: string | null
          id: string
          return_window_days: number
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          brand_id: string
          commission_rate?: number
          created_at?: string | null
          description?: string | null
          id?: string
          return_window_days?: number
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          brand_id?: string
          commission_rate?: number
          created_at?: string | null
          description?: string | null
          id?: string
          return_window_days?: number
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clicks: {
        Row: {
          affiliate_link_id: string | null
          campaign_id: string | null
          clicked_at: string
          creator_id: string | null
          id: string
          ip_hash: string | null
          product_id: string | null
          referrer: string | null
          user_agent: string | null
        }
        Insert: {
          affiliate_link_id?: string | null
          campaign_id?: string | null
          clicked_at?: string
          creator_id?: string | null
          id?: string
          ip_hash?: string | null
          product_id?: string | null
          referrer?: string | null
          user_agent?: string | null
        }
        Update: {
          affiliate_link_id?: string | null
          campaign_id?: string | null
          clicked_at?: string
          creator_id?: string | null
          id?: string
          ip_hash?: string | null
          product_id?: string | null
          referrer?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clicks_affiliate_link_id_fkey"
            columns: ["affiliate_link_id"]
            isOneToOne: false
            referencedRelation: "affiliate_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clicks_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clicks_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clicks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          affiliate_link_id: string | null
          campaign_id: string
          click_id: string | null
          commission_rate: number
          confirms_at: string | null
          created_at: string | null
          creator_id: string
          currency: string
          external_order_id: string | null
          gross_commission: number
          id: string
          net_commission: number
          notes: string | null
          payout_id: string | null
          platform_fee: number
          product_id: string | null
          refunded_amount: number
          return_window_days: number
          sale_amount: number
          shop_domain: string | null
          source: string
          status: string
          updated_at: string | null
        }
        Insert: {
          affiliate_link_id?: string | null
          campaign_id: string
          click_id?: string | null
          commission_rate: number
          confirms_at?: string | null
          created_at?: string | null
          creator_id: string
          currency?: string
          external_order_id?: string | null
          gross_commission: number
          id?: string
          net_commission: number
          notes?: string | null
          payout_id?: string | null
          platform_fee: number
          product_id?: string | null
          refunded_amount?: number
          return_window_days?: number
          sale_amount: number
          shop_domain?: string | null
          source?: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          affiliate_link_id?: string | null
          campaign_id?: string
          click_id?: string | null
          commission_rate?: number
          confirms_at?: string | null
          created_at?: string | null
          creator_id?: string
          currency?: string
          external_order_id?: string | null
          gross_commission?: number
          id?: string
          net_commission?: number
          notes?: string | null
          payout_id?: string | null
          platform_fee?: number
          product_id?: string | null
          refunded_amount?: number
          return_window_days?: number
          sale_amount?: number
          shop_domain?: string | null
          source?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commissions_affiliate_link_id_fkey"
            columns: ["affiliate_link_id"]
            isOneToOne: false
            referencedRelation: "affiliate_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_click_id_fkey"
            columns: ["click_id"]
            isOneToOne: false
            referencedRelation: "clicks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_profiles: {
        Row: {
          bank_account_last4: string | null
          bank_account_name: string | null
          bank_code: string | null
          bank_name: string | null
          bio: string | null
          covo_score: number
          covo_score_updated_at: string | null
          created_at: string | null
          follower_count: number | null
          gender: string | null
          guardrail_acknowledged: boolean
          guardrail_acknowledged_at: string | null
          id: string
          instagram_handle: string | null
          is_verified: boolean
          joined_campaign_ids: number[] | null
          location: string | null
          niche: string | null
          niches: string[] | null
          paystack_recipient_code: string | null
          primary_handle: string | null
          recipient_created_at: string | null
          tiktok_handle: string | null
          updated_at: string | null
          youtube_handle: string | null
        }
        Insert: {
          bank_account_last4?: string | null
          bank_account_name?: string | null
          bank_code?: string | null
          bank_name?: string | null
          bio?: string | null
          covo_score?: number
          covo_score_updated_at?: string | null
          created_at?: string | null
          follower_count?: number | null
          gender?: string | null
          guardrail_acknowledged?: boolean
          guardrail_acknowledged_at?: string | null
          id: string
          instagram_handle?: string | null
          is_verified?: boolean
          joined_campaign_ids?: number[] | null
          location?: string | null
          niche?: string | null
          niches?: string[] | null
          paystack_recipient_code?: string | null
          primary_handle?: string | null
          recipient_created_at?: string | null
          tiktok_handle?: string | null
          updated_at?: string | null
          youtube_handle?: string | null
        }
        Update: {
          bank_account_last4?: string | null
          bank_account_name?: string | null
          bank_code?: string | null
          bank_name?: string | null
          bio?: string | null
          covo_score?: number
          covo_score_updated_at?: string | null
          created_at?: string | null
          follower_count?: number | null
          gender?: string | null
          guardrail_acknowledged?: boolean
          guardrail_acknowledged_at?: string | null
          id?: string
          instagram_handle?: string | null
          is_verified?: boolean
          joined_campaign_ids?: number[] | null
          location?: string | null
          niche?: string | null
          niches?: string[] | null
          paystack_recipient_code?: string | null
          primary_handle?: string | null
          recipient_created_at?: string | null
          tiktok_handle?: string | null
          updated_at?: string | null
          youtube_handle?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creator_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          campaign_id: string | null
          commission_id: string | null
          created_at: string | null
          description: string
          id: string
          raised_by: string
          resolution_notes: string | null
          resolved_by: string | null
          status: string
          type: string
          updated_at: string | null
        }
        Insert: {
          campaign_id?: string | null
          commission_id?: string | null
          created_at?: string | null
          description: string
          id?: string
          raised_by: string
          resolution_notes?: string | null
          resolved_by?: string | null
          status?: string
          type: string
          updated_at?: string | null
        }
        Update: {
          campaign_id?: string | null
          commission_id?: string | null
          created_at?: string | null
          description?: string
          id?: string
          raised_by?: string
          resolution_notes?: string | null
          resolved_by?: string | null
          status?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "disputes_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      escrow_tranches: {
        Row: {
          amount: number
          brand_id: string
          campaign_id: string
          created_at: string | null
          deposited_at: string | null
          escrow_id: string
          id: string
          livemode: boolean
          paystack_reference: string | null
          paystack_status: string
        }
        Insert: {
          amount: number
          brand_id: string
          campaign_id: string
          created_at?: string | null
          deposited_at?: string | null
          escrow_id: string
          id?: string
          livemode?: boolean
          paystack_reference?: string | null
          paystack_status?: string
        }
        Update: {
          amount?: number
          brand_id?: string
          campaign_id?: string
          created_at?: string | null
          deposited_at?: string | null
          escrow_id?: string
          id?: string
          livemode?: boolean
          paystack_reference?: string | null
          paystack_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "escrow_tranches_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escrow_tranches_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escrow_tranches_escrow_id_fkey"
            columns: ["escrow_id"]
            isOneToOne: false
            referencedRelation: "campaign_escrow"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount: number
          commission_ids: string[] | null
          created_at: string | null
          creator_id: string
          id: string
          initiated_by: string | null
          livemode: boolean
          paystack_reference: string | null
          paystack_transfer_code: string | null
          processed_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          commission_ids?: string[] | null
          created_at?: string | null
          creator_id: string
          id?: string
          initiated_by?: string | null
          livemode?: boolean
          paystack_reference?: string | null
          paystack_transfer_code?: string | null
          processed_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          commission_ids?: string[] | null
          created_at?: string | null
          creator_id?: string
          id?: string
          initiated_by?: string | null
          livemode?: boolean
          paystack_reference?: string | null
          paystack_transfer_code?: string | null
          processed_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payouts_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
          campaign_id: string
          created_at: string | null
          id: string
          name: string
          price: number
          tracking_url: string | null
          url: string | null
        }
        Insert: {
          archived_at?: string | null
          campaign_id: string
          created_at?: string | null
          id?: string
          name: string
          price: number
          tracking_url?: string | null
          url?: string | null
        }
        Update: {
          archived_at?: string | null
          campaign_id?: string
          created_at?: string | null
          id?: string
          name?: string
          price?: number
          tracking_url?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          role: string
          status: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          role?: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          role?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      shopify_shops: {
        Row: {
          active: boolean
          brand_id: string
          created_at: string | null
          id: string
          shop_domain: string
          updated_at: string | null
          webhook_secret: string
        }
        Insert: {
          active?: boolean
          brand_id: string
          created_at?: string | null
          id?: string
          shop_domain: string
          updated_at?: string | null
          webhook_secret: string
        }
        Update: {
          active?: boolean
          brand_id?: string
          created_at?: string | null
          id?: string
          shop_domain?: string
          updated_at?: string | null
          webhook_secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_shops_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          contacted: boolean
          created_at: string | null
          email: string
          id: string
          notes: string | null
          source: string | null
          user_agent: string | null
        }
        Insert: {
          contacted?: boolean
          created_at?: string | null
          email: string
          id?: string
          notes?: string | null
          source?: string | null
          user_agent?: string | null
        }
        Update: {
          contacted?: boolean
          created_at?: string | null
          email?: string
          id?: string
          notes?: string | null
          source?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_link_shopify_shop: {
        Args: {
          p_brand_id: string
          p_shop_domain: string
          p_webhook_secret: string
        }
        Returns: {
          linked_brand_id: string
          linked_domain: string
          linked_shop_id: string
        }[]
      }
      admin_list_shopify_shops: {
        Args: never
        Returns: {
          active: boolean
          brand_id: string
          created_at: string
          id: string
          shop_domain: string
        }[]
      }
      apply_paystack_deposit: {
        Args: { p_amount: number; p_livemode?: boolean; p_reference: string }
        Returns: {
          campaign_resumed: boolean
          deposit_applied: boolean
          escrow_after: number
          outcome: string
          released: number
        }[]
      }
      apply_shopify_refund: {
        Args: {
          p_brand_id: string
          p_order_id: string
          p_refunded_amount: number
        }
        Returns: {
          applied: boolean
          new_net: number
          new_status: string
          reason: string
        }[]
      }
      calculate_covo_score: { Args: { p_creator: string }; Returns: number }
      claim_payout_for_transfer: {
        Args: {
          p_payout_id: string
          p_reference: string
          p_transfer_code: string
        }
        Returns: {
          claimed: boolean
          outcome: string
        }[]
      }
      confirm_due_commissions: {
        Args: never
        Returns: {
          campaigns_paused: number
          confirmed_count: number
          held_back: number
          total_value: number
        }[]
      }
      covo_score_breakdown: {
        Args: { p_creator: string }
        Returns: {
          avg_order: number
          clicks: number
          confidence: number
          conv_rate: number
          conversion_points: number
          denied: number
          disputes: number
          order_value_points: number
          reliability_points: number
          sales: number
          total: number
          volume_points: number
        }[]
      }
      covo_score_components: {
        Args: { p_creator: string }
        Returns: {
          avg_order: number
          clicks: number
          confidence: number
          conv_rate: number
          conversion_points: number
          denied: number
          disputes: number
          order_value_points: number
          reliability_points: number
          sales: number
          total: number
          volume_points: number
        }[]
      }
      decrement_escrow_balance: {
        Args: { p_amount: number; p_campaign_id: string }
        Returns: undefined
      }
      increment_escrow_balance: {
        Args: { p_amount: number; p_escrow_id: string }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_direct_client_write: { Args: never; Returns: boolean }
      mark_payout_settled: {
        Args: { p_reference: string; p_status: string }
        Returns: {
          commissions_changed: number
          outcome: string
          payout_updated: boolean
        }[]
      }
      payout_readiness: {
        Args: { p_creator: string }
        Returns: {
          account_last4: string
          account_name: string
          bank_name: string
          confirmed_total: number
          has_recipient: boolean
          meets_minimum: boolean
        }[]
      }
      paystack_test_money: {
        Args: never
        Returns: {
          campaign_id: string
          campaign_title: string
          current_balance: number
          test_deposits: number
          tranche_count: number
        }[]
      }
      product_usage: {
        Args: { p_campaign_id: string }
        Returns: {
          can_delete: boolean
          clicks: number
          commissions: number
          creators: number
          links: number
          product_id: string
          revenue: number
        }[]
      }
      purge_test_paystack_data: {
        Args: never
        Returns: {
          escrows_rebalanced: number
          payouts_removed: number
          tranches_removed: number
        }[]
      }
      record_click: {
        Args: {
          p_campaign_id: string
          p_creator_id: string
          p_ip_hash: string
          p_link_id: string
          p_product_id: string
          p_referrer?: string
          p_user_agent?: string
          p_window_secs?: number
        }
        Returns: {
          click_id: string
          counted: boolean
        }[]
      }
      record_shopify_conversion: {
        Args: {
          p_brand_id?: string
          p_currency?: string
          p_link_id: string
          p_order_id: string
          p_sale_amount: number
          p_shop_domain?: string
        }
        Returns: {
          commission_id: string
          net_commission: number
          reason: string
          recorded: boolean
          status: string
        }[]
      }
      refresh_all_covo_scores: {
        Args: never
        Returns: {
          creators_updated: number
        }[]
      }
      refresh_covo_score: { Args: { p_creator: string }; Returns: number }
      release_held_commissions: {
        Args: { p_campaign_id?: string }
        Returns: {
          released_count: number
          released_value: number
        }[]
      }
      release_payout_claim: {
        Args: { p_payout_id: string; p_reason: string }
        Returns: {
          released: boolean
        }[]
      }
      request_creator_payout: {
        Args: never
        Returns: {
          amount: number
          commission_count: number
          payout_id: string
        }[]
      }
      run_commission_cycle: {
        Args: never
        Returns: {
          confirmed: number
          held: number
          paused: number
          released: number
          total_value: number
        }[]
      }
      set_payout_recipient: {
        Args: {
          p_account_name: string
          p_bank_code: string
          p_bank_name: string
          p_creator: string
          p_last4: string
          p_recipient_code: string
        }
        Returns: {
          outcome: string
          updated: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
