<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Restaurant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class PartnerAccountTest extends TestCase
{
    use RefreshDatabase;

    public function test_partner_can_register_sign_in_and_access_their_restaurant_space(): void
    {
        $this->postJson('/api/auth/register', [
            'restaurant_name' => 'Le Bistrot',
            'name' => 'Camille Martin',
            'email' => 'camille@example.test',
            'phone' => '+33123456789',
            'address' => '12 rue des Fleurs',
            'password' => 'secret-pass-123',
        ])->assertCreated()
            ->assertJsonPath('message', 'Demande d’inscription envoyée. Vous pourrez vous connecter après sa validation.');

        $user = User::where('email', 'camille@example.test')->firstOrFail();
        $this->assertSame('partner', $user->role);
        $this->assertSame('pending', $user->restaurant->status);
        $this->assertTrue(Hash::check('secret-pass-123', $user->password));

        $this->postJson('/api/auth/token', [
            'email' => 'camille@example.test',
            'password' => 'secret-pass-123',
        ])->assertForbidden()
            ->assertJsonPath('message', 'Votre inscription est en attente de validation.');

        Restaurant::whereKey($user->restaurant_id)->update(['status' => 'active']);
        $this->getJson('/api/restaurants')->assertUnauthorized();

        $login = $this->postJson('/api/auth/token', [
            'email' => 'camille@example.test',
            'password' => 'secret-pass-123',
        ])->assertOk()
            ->assertJsonPath('user.role', 'partner')
            ->assertJsonPath('user.restaurant.name', 'Le Bistrot');

        $this->assertSame(
            hash('sha256', $login->json('access')),
            ApiToken::where('type', 'access')->value('token_hash'),
        );
        $accessToken = ApiToken::where('type', 'access')->firstOrFail();
        $accessTokenExpiresAt = $accessToken->expires_at->toDateTimeString();

        $this->withToken($login->json('access'))
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('email', 'camille@example.test')
            ->assertJsonPath('restaurant.name', 'Le Bistrot');

        $this->assertSame(
            $accessTokenExpiresAt,
            $accessToken->fresh()->expires_at->toDateTimeString(),
            'Using an access token must not change its expiration time.',
        );

        $this->withToken($login->json('access'))
            ->getJson('/api/restaurants')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.name', 'Le Bistrot');

        $this->withToken($login->json('access'))
            ->getJson('/api/restaurant-settings')
            ->assertOk()
            ->assertJsonPath('0.restaurant_id', $user->restaurant_id);

        $refreshed = $this->postJson('/api/auth/token/refresh', [
            'refresh' => $login->json('refresh'),
        ])->assertOk();

        $this->assertNotSame($login->json('refresh'), $refreshed->json('refresh'));
        $this->postJson('/api/auth/token/refresh', [
            'refresh' => $login->json('refresh'),
        ])->assertUnauthorized();

        $this->withToken($refreshed->json('access'))
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('email', 'camille@example.test');
    }

    public function test_partner_data_is_scoped_to_the_authenticated_restaurant(): void
    {
        $firstRestaurantId = $this->createPartner('first@example.test', 'Le Premier');
        $firstToken = $this->login('first@example.test');

        $category = $this->withToken($firstToken)->postJson('/api/categories', [
            'restaurant_id' => $firstRestaurantId,
            'name' => 'Entrées',
        ])->assertCreated()->json();

        $secondRestaurantId = $this->createPartner('second@example.test', 'Le Second');
        $secondToken = $this->login('second@example.test');

        $this->withToken($secondToken)
            ->getJson('/api/categories')
            ->assertOk()
            ->assertExactJson([]);

        $this->withToken($secondToken)
            ->getJson("/api/categories/{$category['id']}")
            ->assertNotFound();

        $this->withToken($secondToken)
            ->postJson('/api/categories', [
                'restaurant_id' => $firstRestaurantId,
                'name' => 'Accès interdit',
            ])
            ->assertForbidden();

        $this->withToken($secondToken)
            ->postJson('/api/products', [
                'name' => 'Plat du second restaurant',
                'price' => 1500,
            ])
            ->assertCreated()
            ->assertJsonPath('restaurant_id', $secondRestaurantId);

        $this->withToken($secondToken)
            ->postJson('/api/products', [
                'name' => 'Catégorie du premier restaurant',
                'price' => 1500,
                'category_id' => $category['id'],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('category_id');
    }

    private function createPartner(string $email, string $restaurantName): int
    {
        $this->postJson('/api/auth/register', [
            'restaurant_name' => $restaurantName,
            'name' => 'Partenaire',
            'email' => $email,
            'password' => 'secret-pass-123',
        ])->assertCreated();

        $user = User::where('email', $email)->firstOrFail();
        Restaurant::whereKey($user->restaurant_id)->update(['status' => 'active']);

        return $user->restaurant_id;
    }

    private function login(string $email): string
    {
        return $this->postJson('/api/auth/token', [
            'email' => $email,
            'password' => 'secret-pass-123',
        ])->assertOk()->json('access');
    }
}
