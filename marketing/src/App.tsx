import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { PageErrorBoundary } from './components/ui/PageErrorBoundary';

const HomePage    = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })));
const FeaturesPage = lazy(() => import('./pages/FeaturesPage').then(m => ({ default: m.FeaturesPage })));
const PricingPage  = lazy(() => import('./pages/PricingPage').then(m => ({ default: m.PricingPage })));
const AboutPage    = lazy(() => import('./pages/AboutPage').then(m => ({ default: m.AboutPage })));
const ContactPage  = lazy(() => import('./pages/ContactPage').then(m => ({ default: m.ContactPage })));
const BookDemoPage = lazy(() => import('./pages/BookDemoPage').then(m => ({ default: m.BookDemoPage })));
const FAQPage      = lazy(() => import('./pages/FAQPage').then(m => ({ default: m.FAQPage })));
const BlogPage       = lazy(() => import('./pages/BlogPage').then(m => ({ default: m.BlogPage })));
const NotFoundPage   = lazy(() => import('./pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));
const TermsPage      = lazy(() => import('./pages/TermsPage').then(m => ({ default: m.TermsPage })));
const PrivacyPage    = lazy(() => import('./pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const RefundPage     = lazy(() => import('./pages/RefundPage').then(m => ({ default: m.RefundPage })));
const ShippingPage   = lazy(() => import('./pages/ShippingPage').then(m => ({ default: m.ShippingPage })));

function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#E8380D] border-t-transparent" />
    </div>
  );
}

// New boundary per page, so one page failing doesn't block the next link clicked.
function PageArea({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <PageErrorBoundary key={pathname}>{children}</PageErrorBoundary>;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">
          <PageArea>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/"          element={<HomePage />} />
                <Route path="/features"  element={<FeaturesPage />} />
                <Route path="/pricing"   element={<PricingPage />} />
                <Route path="/about"     element={<AboutPage />} />
                <Route path="/contact"   element={<ContactPage />} />
                <Route path="/book-demo" element={<BookDemoPage />} />
                <Route path="/faq"       element={<FAQPage />} />
                <Route path="/blog"      element={<BlogPage />} />
                <Route path="/terms"     element={<TermsPage />} />
                <Route path="/privacy"   element={<PrivacyPage />} />
                <Route path="/refund"    element={<RefundPage />} />
                <Route path="/shipping"  element={<ShippingPage />} />
                <Route path="*"          element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </PageArea>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}
