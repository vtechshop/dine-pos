import { Link } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';

export function RegisterSuccessPage() {
  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-mist px-4 py-10">
      <div className="my-auto w-full max-w-sm">

        <div className="rounded-2xl border border-border bg-canvas p-10 shadow-sm text-center">
          <CheckCircle className="mx-auto mb-5 h-14 w-14 text-green-500" strokeWidth={1.5} />

          <h1 className="text-xl font-bold text-ink">Application Submitted</h1>
          <p className="mt-3 text-sm text-ink/60 leading-relaxed">
            Your registration is under review. Our team will verify your details and share login
            credentials within 24–48 hours.
          </p>

          <Link
            to="/login"
            className="mt-8 inline-block rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
          >
            Back to Sign In
          </Link>
        </div>

        <p className="mt-5 text-center text-xs text-ink/40">
          Need help?{' '}
          <Link to="/support" className="text-brand hover:underline">
            Contact Support
          </Link>
        </p>
      </div>
    </div>
  );
}
