import { apiFetch } from './client';

export interface RegisterPayload {
  hotelName:    string;
  ownerName:    string;
  phone:        string;
  email:        string;
  businessType: string;
  state:        string;
  city:         string;
}

export interface RegisterResponse {
  message: string;
  hotelId: string;
}

export function registerHotel(payload: RegisterPayload): Promise<RegisterResponse> {
  return apiFetch<RegisterResponse>('/hotels/register', {
    method: 'POST',
    body:   JSON.stringify(payload),
  });
}
