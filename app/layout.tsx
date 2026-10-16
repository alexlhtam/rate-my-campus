import type { Metadata } from 'next';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';
export const metadata: Metadata = { title: 'Rate Our Campus · A little local knowledge', description: 'Find your spot at UCL. Honest campus reviews, society freebies, food to share and student deals around Bloomsbury.', icons: {icon:'/favicon.svg'}, formatDetection: {telephone:false,email:false,address:false} };
export default function RootLayout({children}: Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
