import type { Metadata, Viewport } from 'next'
import { QueryProvider } from '@/components/query-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'RNA-Get Explorer',
  description:
    'A focused workspace for exploring RNA expression matrices, genes, and biosamples.',
  icons: {
    icon: [
      { url: '/icon-light-32x32.png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f8f9fb',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="light">
      <body className="antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
