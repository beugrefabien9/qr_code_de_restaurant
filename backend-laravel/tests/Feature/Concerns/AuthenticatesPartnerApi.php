<?php

namespace Tests\Feature\Concerns;

use App\Models\ApiToken;
use App\Models\Restaurant;
use App\Models\User;
use Illuminate\Support\Str;

trait AuthenticatesPartnerApi
{
    protected function authenticatePartnerApi(): void
    {
        $restaurant = Restaurant::firstOrFail();
        $user = User::create([
            'name' => 'Partenaire de test',
            'email' => 'partner@example.test',
            'password' => 'secret-pass-123',
            'role' => 'partner',
            'restaurant_id' => $restaurant->id,
        ]);
        $token = Str::random(80);

        ApiToken::create([
            'user_id' => $user->id,
            'token_hash' => hash('sha256', $token),
            'type' => 'access',
            'expires_at' => now()->addHour(),
        ]);

        $this->withToken($token);
    }
}
