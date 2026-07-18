import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { MenuProvider } from './context/MenuContext.tsx';
import { CartProvider } from './context/CartContext.tsx';
import { GuestProvider } from './context/GuestContext.tsx';
import { MenuPage } from './pages/MenuPage.tsx';
import { OrderStatusPage } from './pages/OrderStatusPage.tsx';
import { BillPage } from './pages/BillPage.tsx';
import { ErrorPage } from './pages/ErrorPage.tsx';

export default function App() {
  const params      = new URLSearchParams(window.location.search);
  const hotelId     = params.get('hotel') ?? '';
  const tableNumber = params.get('table') ?? '';

  if (!hotelId || !tableNumber) {
    return (
      <ErrorPage
        title="Invalid QR code"
        message="The QR code is missing hotel or table information. Please ask staff for a new QR code."
      />
    );
  }

  return (
    <BrowserRouter>
      <MenuProvider hotelId={hotelId}>
        <CartProvider>
          <GuestProvider hotelId={hotelId} tableId={tableNumber}>
            <Routes>
              <Route
                path="/"
                element={<MenuPage hotelId={hotelId} tableNumber={tableNumber} />}
              />
              <Route
                path="/orders"
                element={<OrderStatusPage hotelId={hotelId} tableNumber={tableNumber} />}
              />
              <Route
                path="/bill"
                element={<BillPage hotelId={hotelId} />}
              />
              <Route
                path="*"
                element={<ErrorPage title="Page not found" message="Please scan the QR code again." />}
              />
            </Routes>
          </GuestProvider>
        </CartProvider>
      </MenuProvider>
    </BrowserRouter>
  );
}
