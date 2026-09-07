import { useRef, useState } from 'react'
import { ScanIcon } from './icons'

// Decodes a single captured still image rather than a live video feed —
// works identically on iOS Safari and Android Chrome, unlike the native
// BarcodeDetector API which iOS doesn't implement at all. Lazy-loaded:
// ZXing adds ~470KB, not worth it in every page's bundle for a feature
// only used occasionally. Shared by the Products search and the rack
// scan-to-add flow — this is the one place that decoding happens.
export function ScanButton({
  onScanned,
  onError,
  label = 'Scan tag',
  className,
}: {
  onScanned: (text: string) => void
  onError?: (message: string) => void
  label?: string
  className?: string
}) {
  const [scanning, setScanning] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setScanning(true)
    const url = URL.createObjectURL(file)
    const { BrowserMultiFormatReader, NotFoundException } = await import('@zxing/library')
    try {
      const reader = new BrowserMultiFormatReader()
      const result = await reader.decodeFromImageUrl(url)
      onScanned(result.getText())
    } catch (err) {
      if (err instanceof NotFoundException) {
        onError?.("Couldn't find a barcode in that photo — try again with it more centred and in focus.")
      } else {
        onError?.('Could not read that photo. Try again.')
      }
    } finally {
      URL.revokeObjectURL(url)
      setScanning(false)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={scanning}
        title="Scan a barcode via your phone camera"
        className={
          className ??
          'flex items-center gap-1.5 rounded-control bg-ink px-4 py-2.25 text-[13px] font-medium text-white hover:opacity-88 disabled:opacity-60'
        }
      >
        <ScanIcon className="h-4 w-4" />
        {scanning ? 'Reading…' : label}
      </button>
    </>
  )
}
