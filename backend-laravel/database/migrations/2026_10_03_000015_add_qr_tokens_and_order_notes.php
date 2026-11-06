<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('products')
            ->where('available_quantity', 1)
            ->where('stock', '>', 1)
            ->update(['available_quantity' => DB::raw('stock')]);

        Schema::table('tables', function (Blueprint $table) {
            $table->uuid('qr_token')->nullable()->unique();
        });

        DB::table('tables')->whereNull('qr_token')->get(['id'])->each(function (object $table): void {
            DB::table('tables')->where('id', $table->id)->update([
                'qr_token' => (string) Str::uuid(),
            ]);
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->string('order_type')->default('dine_in');
            $table->text('note')->nullable();
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->text('note')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn('note');
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['order_type', 'note']);
        });

        Schema::table('tables', function (Blueprint $table) {
            $table->dropUnique(['qr_token']);
            $table->dropColumn('qr_token');
        });
    }
};
