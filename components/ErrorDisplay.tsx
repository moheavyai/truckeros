'use client'

interface ErrorDisplayProps {
  message: string
  subMessage?: string
  onRetry?: () => void
  retryLabel?: string
  variant?: 'inline' | 'full'
}

export default function ErrorDisplay({ 
  message, 
  subMessage, 
  onRetry, 
  retryLabel = "Try again",
  variant = 'full'
}: ErrorDisplayProps) {
  if (variant === 'inline') {
    return (
      <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        <div className="font-medium">{message}</div>
        {subMessage && <div className="text-xs mt-0.5 text-red-600">{subMessage}</div>}
        {onRetry && (
          <button 
            onClick={onRetry}
            className="mt-2 text-xs px-3 py-1 bg-white border border-red-300 rounded hover:bg-red-50"
          >
            {retryLabel}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
        <span className="text-red-600 text-2xl">!</span>
      </div>
      <p className="text-red-700 font-semibold text-lg mb-1">{message}</p>
      {subMessage && (
        <p className="text-red-600 text-sm max-w-md mb-4">{subMessage}</p>
      )}
      {onRetry && (
        <button 
          onClick={onRetry}
          className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm"
        >
          {retryLabel}
        </button>
      )}
    </div>
  )
}
