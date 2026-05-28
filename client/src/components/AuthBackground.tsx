import { useEffect, useState } from 'react';

const CAMPUS_IMAGES = [
  '/Lancaster-Uni-Campus.webp',
  '/Lancaster-Uni-Campus-2.webp',
  '/Lancaster-Uni-Campus-3.webp',
];

const ROTATE_MS = 12000;

export default function AuthBackground() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % CAMPUS_IMAGES.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="authBg" aria-hidden="true">
      {CAMPUS_IMAGES.map((src, i) => (
        <div
          key={src}
          className={`authBgSlide${i === index ? ' authBgSlide--active' : ''}`}
          style={{ backgroundImage: `url(${src})` }}
        />
      ))}
      <div className="authBgOverlay" />
    </div>
  );
}
