export interface Transaction {
  id: string;
  organization_id: string;
  user_id: string;
  amount: number;
  description: string;
  date: Date;
  category_id?: string;
  status: TransactionStatus;
  receipt_url?: string;
  notes?: string;
  merchant?: string;
  payment_method?: string;
  created_at: Date;
  updated_at: Date;
}

export enum TransactionStatus {
  UNMATCHED = 'unmatched',
  CATEGORIZED = 'categorized',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPORTED = 'exported'
}

export interface Category {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  icon?: string;
  parent_id?: string;
  created_at: Date;
}

export interface Receipt {
  id: string;
  transaction_id: string;
  original_filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  uploaded_at: Date;
}

export interface TransactionFilter {
  search?: string;
  status?: TransactionStatus[];
  category_id?: string[];
  date_from?: Date;
  date_to?: Date;
  amount_min?: number;
  amount_max?: number;
  page?: number;
  limit?: number;
}
