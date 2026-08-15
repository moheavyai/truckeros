import { ImageResponse } from 'next/og'

/** iOS home-screen / Safari pinned tab icon — larger M mark on black rounded square. */
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
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
          borderRadius: 36,
          color: '#FFFFFF',
          fontSize: 118,
          fontWeight: 900,
          fontFamily: 'Arial Black, Arial, Helvetica, sans-serif',
          letterSpacing: '-4px',
          lineHeight: 1,
        }}
      >
        M
      </div>
    ),
    { ...size }
  )
}
