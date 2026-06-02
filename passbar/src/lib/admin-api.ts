export type AdminUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  last_seen_at: string | null;
  created_at: string | null;
};

export type AdminStats = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  activeToday: number;
  totalSessions: number;
};

function base() {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function adminHeaders(userId: string) {
  return { 'Content-Type': 'application/json', 'x-admin-user-id': userId };
}

export async function fetchAdminUsers(userId: string): Promise<AdminUser[]> {
  const res = await fetch(`${base()}/api/admin/users`, { headers: adminHeaders(userId) });
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.status}`);
  const json = await res.json();
  return json.users as AdminUser[];
}

export async function fetchAdminStats(userId: string): Promise<AdminStats> {
  const res = await fetch(`${base()}/api/admin/stats`, { headers: adminHeaders(userId) });
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
  return res.json();
}

export async function updateUserStatus(
  adminUserId: string,
  userId: string,
  status: 'pending' | 'approved' | 'rejected',
): Promise<void> {
  const res = await fetch(`${base()}/api/admin/users`, {
    method: 'PATCH',
    headers: adminHeaders(adminUserId),
    body: JSON.stringify({ userId, status }),
  });
  if (!res.ok) throw new Error(`Failed to update user: ${res.status}`);
}
