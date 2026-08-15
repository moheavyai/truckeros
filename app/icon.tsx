import { ImageResponse } from 'next/og'

/** Browser tab icon — black rounded square with bold white M.
 *  Matches the in-app logo mark. Generated at request time so it stays
 *  crisp and never falls back to the default Vercel/Next triangle. */
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000000',
          borderRadius: 6,
          color: '#FFFFFF',
          fontSize: 22,
          fontWeight: 900,
          fontFamily: 'Arial Black, Arial, Helvetica, sans-serif',
          letterSpacing: '-1px',
          lineHeight: 1,
        }}
      >
        M
      </div>
    ),
    { ...size }
  )
}
