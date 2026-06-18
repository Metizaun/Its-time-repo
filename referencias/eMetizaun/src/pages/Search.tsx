import { MobileSearch } from '@/components/ui/mobile-search';
import { MobileHeader } from '@/components/ui/mobile-header';

export default function Search() {
  return (
    <div className="space-y-6">
      <MobileHeader
        title="Search"
        subtitle="Search across all your CRM data"
      />
      <MobileSearch />
    </div>
  );
}