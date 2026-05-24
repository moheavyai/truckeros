'use client'

interface BrandedLoaderProps {
  message?: string
  subMessage?: string
  size?: 'sm' | 'md' | 'lg'
}

export default function BrandedLoader({ 
  message = "Loading...", 
  subMessage,
  size = 'md' 
}: BrandedLoaderProps) {
  const logoSize = size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-16 h-16' : 'w-12 h-12'
  const textSize = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg'

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className={`${logoSize} bg-black rounded-xl flex items-center justify-center mb-4 shadow-sm`}>
        <span className="text-white font-bold tracking-tighter" style={{ fontSize: size === 'lg' ? '2rem' : '1.5rem' }}>
          T
        </span>
      </div>
      <p className={`text-gray-700 font-semibold ${textSize}`}>{message}</p>
      {subMessage && (
        <p className="text-gray-500 text-sm mt-1 text-center max-w-xs">{subMessage}</p>
      )}
    </div>
  )
}
