interface ErrorPageProps {
  title?:   string;
  message?: string;
}

export function ErrorPage({
  title   = 'Something went wrong',
  message = 'Please scan the QR code again.',
}: ErrorPageProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#FFF6EE] p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-[#E8380D]/10 flex items-center justify-center mb-4 text-2xl">
        ⚠️
      </div>
      <h1 className="text-lg font-semibold text-[#1C0800] mb-2">{title}</h1>
      <p className="text-sm text-[#1C0800]/60 max-w-xs">{message}</p>
    </div>
  );
}
