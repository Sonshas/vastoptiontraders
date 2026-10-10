import { Link } from '@tanstack/react-router';
import { useSiteName } from '@/hooks/use-site-name';

export function Brand() {
  const name = useSiteName();
  const lower = name.toLowerCase().replace(/\s+/g, '');
  const split = Math.max(1, Math.round(lower.length / 3));
  return (
    <Link to="/" className="brand" aria-label={`${name} home`}>
      <span className="brand-symbol" aria-hidden="true"><i /><i /><i /></span>
      <span className="brand-type">{lower.slice(0, split)}<span>{lower.slice(split)}</span></span>
    </Link>
  );
}
