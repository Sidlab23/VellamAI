import dynamic from 'next/dynamic'

// Disable SSR for the entire app — it uses browser APIs (WebSocket, window.confirm)
const App = dynamic(() => import('../App'), { ssr: false })

export default function Home() {
  return <App />
}
