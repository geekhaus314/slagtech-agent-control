const users: Array<{ id: number; name: string }> = [];

export function addUser(name: string) {
  users.push({ id: users.length + 1, name });
  return users;
}
