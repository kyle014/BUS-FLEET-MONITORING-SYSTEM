import { Outlet, useNavigate } from 'react-router';
import { Navbar } from '../Navbar';

export type PassengerPage = 'passenger' | 'lostandfound';

export default function PassengerLayout() {
  const navigate = useNavigate();

  const handleNavigate = (page: PassengerPage) => {
    if (page === 'passenger') {
      navigate('/passenger');
    } else {
      navigate(`/passenger/${page}`);
    }
  };

  const handleLogout = () => {
    navigate('/');
  };

  return (
    <>
      <Navbar 
        currentPage="passenger" 
        onNavigate={handleNavigate}
        userRole="passenger"
        onLogout={handleLogout}
      />
      <main className="pt-16">
        <Outlet />
      </main>
    </>
  );
}
