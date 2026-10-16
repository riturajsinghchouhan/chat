import { lazy, Suspense } from 'react';
import { Spinner } from './LoadingSkeleton';

const Picker = lazy(() => import('emoji-picker-react'));

export default function EmojiPicker({ onSelect, width = 340, height = 400 }) {
  const dark = document.documentElement.classList.contains('dark');
  return (
    <Suspense
      fallback={
        <div className="neu flex items-center justify-center rounded-3xl text-accent" style={{ width, height }}>
          <Spinner />
        </div>
      }
    >
      <Picker
        onEmojiClick={(data) => onSelect(data.emoji)}
        colorScheme={dark ? 'dark' : 'light'}
        emojiStyle="native"
        lazyLoadEmojis
        autoFocusSearch={false}
        previewConfig={{ showPreview: false }}
        width={width}
        height={height}
      />
    </Suspense>
  );
}
