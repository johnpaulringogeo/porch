import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Porch',
    template: '%s · Porch',
  },
  description:
    'Porch is a persona-native social platform with five modes: Home, Public, Community, Professional, and Creators.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body data-mode="home">{children}</body>
    </html>
  );
}
