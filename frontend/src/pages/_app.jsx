import Head from 'next/head'
import '../index.css'

export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Vellam AI — Local Agent</title>
      </Head>
      <Component {...pageProps} />
    </>
  )
}
