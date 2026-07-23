import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { HomePage }    from './pages/HomePage';
import { FeaturesPage } from './pages/FeaturesPage';
import { PricingPage }  from './pages/PricingPage';
import { AboutPage }    from './pages/AboutPage';
import { ContactPage }  from './pages/ContactPage';
import { BookDemoPage } from './pages/BookDemoPage';
import { FAQPage }      from './pages/FAQPage';
import { BlogPage }     from './pages/BlogPage';

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
          <Routes>
            <Route path="/"          element={<HomePage />} />
            <Route path="/features"  element={<FeaturesPage />} />
            <Route path="/pricing"   element={<PricingPage />} />
            <Route path="/about"     element={<AboutPage />} />
            <Route path="/contact"   element={<ContactPage />} />
            <Route path="/book-demo" element={<BookDemoPage />} />
            <Route path="/faq"       element={<FAQPage />} />
            <Route path="/blog"      element={<BlogPage />} />
            {/* Fallback */}
            <Route path="*"          element={<HomePage />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}
