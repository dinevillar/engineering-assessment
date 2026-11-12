import { Suspense } from 'react';
import { ReviewApp } from './components/ReviewApp.tsx';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReviewApp />
    </Suspense>
  );
}
