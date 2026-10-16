import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import EmptyState from '../components/EmptyState';

export default function NotFoundPage() {
  return (
    <div className="h-dvh w-full bg-base">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you are looking for doesn't exist or was moved."
        action={
          <Link to="/" className="btn-primary">
            Go to chats
          </Link>
        }
      />
    </div>
  );
}
