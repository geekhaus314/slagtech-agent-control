import leftPad from 'left-pad';

export const mockUsers = [
  { id: 1, name: 'John Doe', email: 'john@example.com', role: 'admin' },
  { id: 2, name: 'Jane Doe', email: 'jane@example.com', role: 'user' },
];

export function labelUser(id: number): any {
  return leftPad(String(id), 6, '0');
}

export const apiKey = process.env.SECRET_KEY;
