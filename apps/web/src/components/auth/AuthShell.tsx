import type { ReactNode } from 'react';

/** The frame around the sign-in and register forms: calm, centred, the paper's own serif. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="pt-s3-page flex items-center justify-center" style={{ padding: 16 }}>
      <div className="w-full" style={{ maxWidth: 420 }}>
        <div className="mb-6">
          <p className="pt-s3-brand">PaperTree</p>
          <h1 className="pt-s3-h1 mt-4">{title}</h1>
          <p className="pt-s3-muted mt-2 text-sm">{subtitle}</p>
        </div>
        <div className="pt-s3-panel">{children}</div>
      </div>
    </main>
  );
}
