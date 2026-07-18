import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface BaseProps {
  variant?: 'primary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  className?: string;
}

interface ButtonProps extends BaseProps {
  as?: 'button';
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
}

interface LinkProps extends BaseProps {
  as: 'link';
  to: string;
}

interface AnchorProps extends BaseProps {
  as: 'a';
  href: string;
}

type Props = ButtonProps | LinkProps | AnchorProps;

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8380D]/50';

const VARIANTS = {
  primary: 'bg-[#E8380D] text-white hover:bg-[#C93008]',
  outline: 'border border-gray-200 bg-white text-gray-800 hover:bg-gray-50',
  ghost:   'text-gray-700 hover:bg-gray-100',
};

const SIZES = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-7 py-3.5 text-base',
};

export function Button(props: Props) {
  const { variant = 'primary', size = 'md', children, className = '' } = props;
  const cls = `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`;

  if (props.as === 'link') {
    return <Link to={props.to} className={cls}>{children}</Link>;
  }
  if (props.as === 'a') {
    return <a href={props.href} className={cls}>{children}</a>;
  }
  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`${cls} disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
