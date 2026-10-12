import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Rate My Campus · A little local knowledge', description: 'Find your spot at UCL. Honest campus reviews, society freebies, food to share and student deals around Bloomsbury.', icons: {icon:'/favicon.svg'} };
export default function RootLayout({children}: Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
