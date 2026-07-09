// Small button wrapper for the recurring legacy button styles.
const VARIANTS = {
  primary: 'border border-transparent text-white bg-blue-600 hover:bg-blue-700 shadow-sm',
  success: 'border border-transparent text-white bg-green-600 hover:bg-green-700 shadow-sm',
  secondary: 'border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 shadow-sm'
};

export default function Button({ variant = 'primary', className = '', children, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
