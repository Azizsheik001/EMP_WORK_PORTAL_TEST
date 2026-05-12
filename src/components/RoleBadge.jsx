/**
 * Shows M (Manager), TL (Team Lead), CEO next to user names. CEO for Shree and Siva.
 */
export default function RoleBadge({ user, className = '' }) {
  if (!user) return null;
  const name = user.name || '';
  const role = user.role || user.type;
  const isCEO = role === 'admin' && (name.toLowerCase().includes('shree') || name.toLowerCase().includes('siva'));
  const label = isCEO ? 'CEO' : role === 'manager' ? 'M' : role === 'team_lead' ? 'TL' : null;
  if (!label) return null;

  const bgColor = isCEO ? 'bg-[#1e3a5f]' : role === 'manager' ? 'bg-[#7c3aed]' : 'bg-brand';

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ml-1 text-white ${bgColor} ${className}`}
      title={isCEO ? 'CEO' : role === 'manager' ? 'Manager' : 'Team Lead'}
    >
      {label}
    </span>
  );
}
