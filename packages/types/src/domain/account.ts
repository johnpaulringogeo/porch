export const AccountStatus = {
  Active: 'active',
  Restricted: 'restricted',
  Suspended: 'suspended',
  DeletionRequested: 'deletion_requested',
  Deleted: 'deleted',
} as const;

export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export interface Account {
  id: string;
  email: string;
  emailVerified: boolean;
  status: AccountStatus;
  createdAt: string;
}
