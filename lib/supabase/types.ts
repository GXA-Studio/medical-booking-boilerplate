// AUTO-GENERATED — do not edit manually.
// Regenerate with: npm run db:types
// Source of truth is supabase/migrations/001_initial.sql

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      appointments: {
        Row: {
          clinic_id: string
          created_at: string
          doctor_id: string
          ends_at: string
          id: string
          notes: string | null
          otp_code_hash: string | null
          otp_expires_at: string | null
          patient_name: string
          patient_phone: string
          service_id: string
          starts_at: string
          status: Database['public']['Enums']['appointment_status']
        }
        Insert: {
          clinic_id: string
          created_at?: string
          doctor_id: string
          ends_at: string
          id?: string
          notes?: string | null
          otp_code_hash?: string | null
          otp_expires_at?: string | null
          patient_name: string
          patient_phone: string
          service_id: string
          starts_at: string
          status?: Database['public']['Enums']['appointment_status']
        }
        Update: {
          clinic_id?: string
          created_at?: string
          doctor_id?: string
          ends_at?: string
          id?: string
          notes?: string | null
          otp_code_hash?: string | null
          otp_expires_at?: string | null
          patient_name?: string
          patient_phone?: string
          service_id?: string
          starts_at?: string
          status?: Database['public']['Enums']['appointment_status']
        }
        Relationships: [
          { foreignKeyName: 'appointments_clinic_id_fkey'; columns: ['clinic_id']; referencedRelation: 'clinics'; referencedColumns: ['id'] },
          { foreignKeyName: 'appointments_doctor_id_fkey'; columns: ['doctor_id']; referencedRelation: 'doctors'; referencedColumns: ['id'] },
          { foreignKeyName: 'appointments_service_id_fkey'; columns: ['service_id']; referencedRelation: 'services'; referencedColumns: ['id'] },
        ]
      }
      clinics: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          phone: string | null
          settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      doctor_services: {
        Row: {
          doctor_id: string
          service_id: string
        }
        Insert: {
          doctor_id: string
          service_id: string
        }
        Update: {
          doctor_id?: string
          service_id?: string
        }
        Relationships: [
          { foreignKeyName: 'doctor_services_doctor_id_fkey'; columns: ['doctor_id']; referencedRelation: 'doctors'; referencedColumns: ['id'] },
          { foreignKeyName: 'doctor_services_service_id_fkey'; columns: ['service_id']; referencedRelation: 'services'; referencedColumns: ['id'] },
        ]
      }
      doctors: {
        Row: {
          avatar_url: string | null
          clinic_id: string
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          specialty: string | null
        }
        Insert: {
          avatar_url?: string | null
          clinic_id: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          specialty?: string | null
        }
        Update: {
          avatar_url?: string | null
          clinic_id?: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          specialty?: string | null
        }
        Relationships: [
          { foreignKeyName: 'doctors_clinic_id_fkey'; columns: ['clinic_id']; referencedRelation: 'clinics'; referencedColumns: ['id'] },
        ]
      }
      profiles: {
        Row: {
          clinic_id: string | null
          created_at: string
          full_name: string | null
          id: string
          role: string
        }
        Insert: {
          clinic_id?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          role?: string
        }
        Update: {
          clinic_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          role?: string
        }
        Relationships: [
          { foreignKeyName: 'profiles_clinic_id_fkey'; columns: ['clinic_id']; referencedRelation: 'clinics'; referencedColumns: ['id'] },
          { foreignKeyName: 'profiles_id_fkey'; columns: ['id']; referencedRelation: 'users'; referencedColumns: ['id'] },
        ]
      }
      schedules: {
        Row: {
          day_of_week: number
          doctor_id: string
          end_time: string
          id: string
          is_active: boolean
          start_time: string
        }
        Insert: {
          day_of_week: number
          doctor_id: string
          end_time: string
          id?: string
          is_active?: boolean
          start_time: string
        }
        Update: {
          day_of_week?: number
          doctor_id?: string
          end_time?: string
          id?: string
          is_active?: boolean
          start_time?: string
        }
        Relationships: [
          { foreignKeyName: 'schedules_doctor_id_fkey'; columns: ['doctor_id']; referencedRelation: 'doctors'; referencedColumns: ['id'] },
        ]
      }
      services: {
        Row: {
          clinic_id: string
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          price: number | null
        }
        Insert: {
          clinic_id: string
          created_at?: string
          description?: string | null
          duration_minutes: number
          id?: string
          is_active?: boolean
          name: string
          price?: number | null
        }
        Update: {
          clinic_id?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          price?: number | null
        }
        Relationships: [
          { foreignKeyName: 'services_clinic_id_fkey'; columns: ['clinic_id']; referencedRelation: 'clinics'; referencedColumns: ['id'] },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      book_slot: {
        Args: {
          p_clinic_id: string
          p_doctor_id: string
          p_service_id: string
          p_patient_name: string
          p_patient_phone: string
          p_starts_at: string
          p_otp_code_hash: string
        }
        Returns: Database['public']['Tables']['appointments']['Row']
      }
      confirm_appointment: {
        Args: {
          p_appointment_id: string
          p_otp_code_hash: string
        }
        Returns: Database['public']['Tables']['appointments']['Row']
      }
      get_available_slots: {
        Args: {
          p_doctor_id: string
          p_service_id: string
          p_date: string
        }
        Returns: { slot_start: string }[]
      }
    }
    Enums: {
      appointment_status: 'cancelled' | 'confirmed' | 'pending'
    }
    CompositeTypes: { [_ in never]: never }
  }
}

// Convenience type aliases
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]

// Domain type aliases for use throughout the app
export type Clinic = Tables<'clinics'>
export type Service = Tables<'services'>
export type Doctor = Tables<'doctors'>
export type Schedule = Tables<'schedules'>
export type Appointment = Tables<'appointments'>
export type Profile = Tables<'profiles'>
export type AppointmentStatus = Enums<'appointment_status'>
