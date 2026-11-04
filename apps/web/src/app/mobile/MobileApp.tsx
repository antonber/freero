// Inside Freero's phone and tablet apps (#177): links the app is opened with and tapped push
// notifications navigate here. Renders nothing; does nothing in a browser.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { startMobileApp } from '../notifications/push';

export function MobileApp() {
  const navigate = useNavigate();
  useEffect(() => startMobileApp((path) => navigate(path)), [navigate]);
  return null;
}
