import { AggregateRoot } from './base/AggregateRoot.js';
import { UserCreated } from '../events/UserCreated.js';
import { UserUpdated } from '../events/UserUpdated.js';

export class User extends AggregateRoot {
  private _email: string;
  private _name: string | null;
  private _createdAt: Date;
  private _updatedAt: Date;
  private _role: string;
  private _permissions: string[];
  constructor(
    id: string,
    email: string,
    name: string | null,
    role: string,
    permissions: string[],
    createdAt: Date = new Date(),
    updatedAt: Date = new Date()
  ) {
    super(id);
    this._email = email;
    this._name = name;
    this._role = role;
    this._permissions = permissions;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
  }

  public static create(
    id: string,
    email: string,
    name: string | null = null,
    role: string = 'user',
    permissions: string[] = []
  ): User {
    const user = new User(id, email, name, role, permissions);

    user.addDomainEvent(
      new UserCreated(
        id,
        email,
        name,
        user.version
      )
    );

    return user;
  }

  get email(): string {
    return this._email;
  }

  get name(): string | null {
    return this._name;
  }

  get role(): string {
    return this._role;
  }

  get permissions(): string[] {
    return this._permissions;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  public update(
    email?: string,
    name?: string | null,
    role?: string,
    permissions?: string[]
  ): void {
    let hasChanges = false;

    if (email && email !== this._email) {
      this._email = email;
      hasChanges = true;
    }

    if (name !== undefined && name !== this._name) {
      this._name = name;
      hasChanges = true;
    }

    if (role !== undefined && role !== this._role) {
      this._role = role;
      hasChanges = true;
    }

    if (permissions !== undefined && permissions !== this._permissions) {
      this._permissions = permissions;
      hasChanges = true;
    }

    if (hasChanges) {
      this._updatedAt = new Date();
      this.addDomainEvent(
        new UserUpdated(
          this.id,
          email,
          name,
          role,
          permissions,
          this.version
        )
      );
    }
  }

  public isValidEmail(): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(this._email);
  }
}