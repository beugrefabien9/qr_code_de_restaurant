<?php

namespace Tests\Feature;

use App\Models\Restaurant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class GlobalAdminAccountTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_account_code_is_generated_locally_and_can_only_be_used_once(): void
    {
        Cache::forget('admin_setup_key');

        $this->postJson('/api/auth/admin/register', [
            'setup_key' => 'guessed-code',
            'name' => 'Admin',
            'email' => 'admin@example.test',
            'password' => 'secure-pass-123',
        ])->assertForbidden();

        $setup = $this->getJson('/api/auth/admin/setup')->assertOk();
        $setupKey = $setup->json('setup_key');
        $this->assertIsString($setupKey);
        $this->assertNotEmpty($setupKey);

        $this->postJson('/api/auth/admin/register', [
            'setup_key' => $setupKey,
            'name' => 'Admin général',
            'email' => 'admin@example.test',
            'password' => 'secure-pass-123',
        ])->assertCreated();

        $admin = User::where('email', 'admin@example.test')->firstOrFail();
        $this->assertSame('admin', $admin->role);
        $this->assertNull($admin->restaurant_id);

        $login = $this->postJson('/api/auth/token', [
            'email' => 'admin@example.test',
            'password' => 'secure-pass-123',
        ])->assertOk()->assertJsonPath('user.role', 'admin');

        $this->postJson('/api/auth/admin/register', [
            'setup_key' => $setupKey,
            'name' => 'Second Admin',
            'email' => 'second-admin@example.test',
            'password' => 'secure-pass-456',
        ])->assertStatus(409);

        $this->getJson('/api/auth/admin/setup')->assertStatus(409);

        $this->withToken($login->json('access'))
            ->getJson('/api/restaurants')
            ->assertOk();
    }

    public function test_admin_setup_and_registration_are_blocked_from_other_devices(): void
    {
        $this->withServerVariables(['REMOTE_ADDR' => '192.168.1.20'])
            ->getJson('/api/auth/admin/setup')
            ->assertForbidden();

        $this->withServerVariables(['REMOTE_ADDR' => '192.168.1.20'])
            ->postJson('/api/auth/admin/register', [
                'setup_key' => 'anything',
                'name' => 'Admin',
                'email' => 'admin@example.test',
                'password' => 'secure-pass-123',
            ])
            ->assertForbidden();
    }

    public function test_global_admin_can_view_data_across_partner_restaurants(): void
    {
        Cache::forget('admin_setup_key');

        foreach ([
            ['restaurant' => 'Premier restaurant', 'email' => 'first@example.test', 'category' => 'Entrées'],
            ['restaurant' => 'Deuxième restaurant', 'email' => 'second@example.test', 'category' => 'Desserts'],
        ] as $account) {
            $this->postJson('/api/auth/register', [
                'restaurant_name' => $account['restaurant'],
                'name' => 'Partenaire',
                'email' => $account['email'],
                'password' => 'secure-pass-123',
            ])->assertCreated();

            $partner = User::where('email', $account['email'])->firstOrFail();
            Restaurant::whereKey($partner->restaurant_id)->update(['status' => 'active']);
            $partnerLogin = $this->postJson('/api/auth/token', [
                'email' => $account['email'],
                'password' => 'secure-pass-123',
            ])->assertOk();

            $this->withToken($partnerLogin->json('access'))
                ->postJson('/api/categories', [
                    'restaurant_id' => $partner->restaurant_id,
                    'name' => $account['category'],
                ])->assertCreated();
        }

        $setupKey = $this->getJson('/api/auth/admin/setup')->assertOk()->json('setup_key');
        $this->postJson('/api/auth/admin/register', [
            'setup_key' => $setupKey,
            'name' => 'Admin général',
            'email' => 'admin@example.test',
            'password' => 'secure-pass-123',
        ])->assertCreated();

        $adminLogin = $this->postJson('/api/auth/token', [
            'email' => 'admin@example.test',
            'password' => 'secure-pass-123',
        ])->assertOk();

        $this->withToken($adminLogin->json('access'))
            ->getJson('/api/restaurants')
            ->assertOk()
            ->assertJsonCount(2);

        $this->withToken($adminLogin->json('access'))
            ->getJson('/api/categories')
            ->assertOk()
            ->assertJsonCount(2);
    }
}
