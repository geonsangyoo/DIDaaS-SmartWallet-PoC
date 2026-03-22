export type Role = "employee" | "admin1" | "admin2";

export interface Confirmation {
  owner: string;
  signature: string;
}

export interface SafeTransaction {
  safeTxHash: string;
  to: string;
  value: string;
  confirmations: Confirmation[];
  confirmationsRequired: number;
  submissionDate: string;
  isExecuted: boolean;
  transactionHash: string | null;
}

export interface SafeInfo {
  safeAddress: string;
  isDeployed: boolean;
  pendingTransactions: SafeTransaction[];
}
